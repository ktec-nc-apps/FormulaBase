<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Controller;

use OCA\FormulaBase\AppInfo\Application;
use OCA\FormulaBase\Db\CollectionEntity;
use OCA\FormulaBase\Db\CollectionMapper;
use OCA\FormulaBase\Db\FormulaEntity;
use OCA\FormulaBase\Db\FormulaMapper;
use OCA\FormulaBase\Db\HistoryEntity;
use OCA\FormulaBase\Db\HistoryMapper;
use OCA\FormulaBase\Db\ShareEntity;
use OCA\FormulaBase\Db\ShareMapper;
use OCA\FormulaBase\Service\ForbiddenException;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\DataDownloadResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IConfig;
use OCP\IL10N;
use OCP\IRequest;
use OCP\ITempManager;
use OCP\IUserManager;
use OCP\IUserSession;
use OCP\L10N\IFactory;

class ApiController extends Controller {
	/** Theme is an appearance mode only (matches RegiBase): follow Nextcloud, or force light/dark. */
	private const ALLOWED_THEMES = ['auto', 'light', 'dark'];

	// recipient permission ranks; the owner is implicitly above all of these.
	public const PERM_VIEW = 'view';
	public const PERM_EDIT = 'edit';
	public const PERM_DELETE = 'delete';
	private const PERM_RANK = ['view' => 1, 'edit' => 2, 'delete' => 3];

	public function __construct(
		IRequest $request,
		private IUserSession $userSession,
		private IConfig $config,
		private IL10N $l,
		private ITempManager $tempManager,
		private IUserManager $userManager,
		private CollectionMapper $collections,
		private FormulaMapper $formulas,
		private HistoryMapper $historyMapper,
		private ShareMapper $shares,
		private IFactory $l10nFactory,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/** Language codes for which we ship an l10n/<code>.json bundle. */
	private function languageCodes(): array {
		$out = [];
		foreach (glob(__DIR__ . '/../../l10n/*.json') ?: [] as $p) {
			$out[] = basename($p, '.json');
		}
		return $out;
	}

	/** Available UI languages as [{code, name}], name being the endonym. */
	private function availableLanguages(): array {
		$names = [
			'en' => 'English', 'ja' => '日本語', 'zh' => '简体中文', 'es' => 'Español',
			'fr' => 'Français', 'de' => 'Deutsch', 'ru' => 'Русский', 'pt' => 'Português',
			'ar' => 'العربية', 'hi' => 'हिन्दी', 'ko' => '한국어', 'it' => 'Italiano',
		];
		// The 'auto' option is rendered explicitly in the template (matches RegiBase),
		// so this list contains only the shipped concrete languages.
		$out = [];
		foreach ($this->languageCodes() as $c) {
			$out[] = ['code' => $c, 'name' => $names[$c] ?? $c];
		}
		return $out;
	}

	private function settingsPayload(string $uid): array {
		return [
			'theme' => $this->config->getUserValue($uid, Application::APP_ID, 'theme', 'auto'),
			'language' => $this->config->getUserValue($uid, Application::APP_ID, 'language', 'auto'),
			'languages' => $this->availableLanguages(),
		];
	}

	#[NoAdminRequired]
	public function getSettings(): JSONResponse {
		return new JSONResponse($this->settingsPayload($this->uid()));
	}

	#[NoAdminRequired]
	public function updateSettings(): JSONResponse {
		$uid = $this->uid();
		$params = $this->request->getParams();
		if (array_key_exists('theme', $params)) {
			$theme = (string)$params['theme'];
			if (in_array($theme, self::ALLOWED_THEMES, true)) {
				$this->config->setUserValue($uid, Application::APP_ID, 'theme', $theme);
			}
		}
		if (array_key_exists('language', $params)) {
			$lang = (string)$params['language'];
			if ($lang === 'auto' || in_array($lang, $this->languageCodes(), true)) {
				$this->config->setUserValue($uid, Application::APP_ID, 'language', $lang);
			}
		}
		return new JSONResponse($this->settingsPayload($uid));
	}

	/** Return the raw translation map for a shipped language (for in-app language override). */
	#[NoAdminRequired]
	public function getI18n(string $lang): JSONResponse {
		if (!in_array($lang, $this->languageCodes(), true)) {
			return new JSONResponse(['error' => 'unknown language'], Http::STATUS_NOT_FOUND);
		}
		$base = realpath(__DIR__ . '/../../l10n');
		$path = realpath(__DIR__ . '/../../l10n/' . $lang . '.json');
		if ($path === false || $base === false || strpos($path, $base) !== 0) {
			return new JSONResponse(['error' => 'not found'], Http::STATUS_NOT_FOUND);
		}
		$data = json_decode((string)file_get_contents($path), true);
		return new JSONResponse(['translations' => $data['translations'] ?? []]);
	}

	/**
	 * The full Unicode 14.0 emoji set for the icon picker, plus the CLDR names and
	 * keywords in $lang so the picker can be searched in the user's own language.
	 * Fetched lazily (only when the picker is first opened) — it is ~150 KB.
	 * 'auto' follows the Nextcloud language; anything unknown falls back to English.
	 */
	#[NoAdminRequired]
	public function getEmoji(string $lang = 'auto'): JSONResponse {
		if (!in_array($lang, $this->languageCodes(), true)) {
			$lang = substr($this->l10nFactory->findLanguage(Application::APP_ID), 0, 2);
		}
		$base = realpath(__DIR__ . '/../../data/emoji');
		if ($base === false) {
			return new JSONResponse(['error' => 'not found'], Http::STATUS_NOT_FOUND);
		}
		$names = realpath($base . '/' . $lang . '.json');
		if ($names === false || strpos($names, $base) !== 0) {
			$names = $base . '/en.json';
		}
		$list = json_decode((string)file_get_contents($base . '/list.json'), true);
		return new JSONResponse([
			'version' => $list['version'] ?? '',
			'groups' => $list['groups'] ?? [],
			'names' => json_decode((string)file_get_contents($names), true) ?: [],
		]);
	}

	/**
	 * Formula templates (~3000 famous formulas) are not shipped in the JS bundle — the
	 * picker loads a lightweight search index once, then each genre's full body (with
	 * description/notes) only when that genre is expanded. See data/templates/.
	 */
	private function templatesDataDir(): string {
		return __DIR__ . '/../../data/templates';
	}

	/** Lightweight index: {name, cat, expression, variables:[{key,label,default}]} for every template. */
	#[NoAdminRequired]
	public function templatesIndex(): JSONResponse {
		$path = $this->templatesDataDir() . '/index.json';
		$data = json_decode((string)@file_get_contents($path), true);
		return new JSONResponse($data ?? []);
	}

	/** Full template bodies for one category, resolved via manifest.json (exact-name lookup, no path building from input). */
	#[NoAdminRequired]
	public function templatesCat(string $cat): JSONResponse {
		$dir = $this->templatesDataDir();
		$manifest = json_decode((string)@file_get_contents($dir . '/manifest.json'), true);
		if (!is_array($manifest) || !isset($manifest[$cat])) {
			return new JSONResponse(['error' => 'unknown category'], Http::STATUS_NOT_FOUND);
		}
		$base = realpath($dir);
		$path = realpath($dir . '/' . $manifest[$cat]);
		if ($path === false || $base === false || strpos($path, $base) !== 0) {
			return new JSONResponse(['error' => 'not found'], Http::STATUS_NOT_FOUND);
		}
		$data = json_decode((string)file_get_contents($path), true);
		return new JSONResponse($data ?? []);
	}

	private function uid(): string {
		$u = $this->userSession->getUser();
		return $u ? $u->getUID() : '';
	}

	private function now(): string {
		return gmdate('Y-m-d\TH:i:s\Z');
	}

	/** Ensure the collection exists and belongs to the current user (owner only). */
	private function ownedCollection(int $id): ?CollectionEntity {
		try {
			return $this->collections->findForUser($id, $this->uid());
		} catch (DoesNotExistException $e) {
			return null;
		}
	}

	private function forbidden(): JSONResponse {
		return new JSONResponse(['error' => $this->l->t('You do not have permission to do that')], Http::STATUS_FORBIDDEN);
	}

	private function displayName(string $uid): string {
		$u = $this->userManager->get($uid);
		return $u ? $u->getDisplayName() : $uid;
	}

	/**
	 * Resolve access to a collection for the current user.
	 * @return array{0: CollectionEntity, 1: string, 2: bool, 3: ?ShareEntity} [collection, perm, isOwner, share]
	 * @throws DoesNotExistException when the user has no access at all
	 */
	private function resolve(int $id): array {
		$uid = $this->uid();
		try {
			$c = $this->collections->findForUser($id, $uid);
			return [$c, 'owner', true, null];
		} catch (DoesNotExistException $e) {
			// fall through: maybe it is shared to this user
		}
		$share = $this->shares->findOne($id, $uid);
		if ($share === null) {
			throw new DoesNotExistException('no access to collection');
		}
		return [$this->collections->findById($id), $share->getPerm(), false, $share];
	}

	/**
	 * Resolve and enforce that the current user has at least the $min permission.
	 * @throws ForbiddenException when access exists but the level is too low
	 * @throws DoesNotExistException when there is no access
	 */
	private function require(int $id, string $min): array {
		$res = $this->resolve($id);
		[, $perm, $isOwner] = $res;
		if (!$isOwner) {
			$have = self::PERM_RANK[$perm] ?? 0;
			$need = self::PERM_RANK[$min] ?? 99;
			if ($have < $need) {
				throw new ForbiddenException('permission denied');
			}
		}
		return $res;
	}

	/** Add sharing flags (is_owner/perm/shared_*) to a serialized collection. */
	private function decorateShare(array $j, bool $isOwner, ?ShareEntity $share): array {
		$cid = (int)$j['id'];
		if ($isOwner) {
			$sharedByMe = $this->shares->collectionIsShared($cid);
			$j['is_owner'] = true;
			$j['perm'] = 'owner';
			$j['shared'] = $sharedByMe;
			$j['shared_by_me'] = $sharedByMe;
			$j['shared_with_me'] = false;
		} else {
			$j['is_owner'] = false;
			$j['perm'] = $share->getPerm();
			$j['shared'] = true;
			$j['shared_by_me'] = false;
			$j['shared_with_me'] = true;
			$j['owner_uid'] = $share->getOwnerUid();
		}
		return $j;
	}

	#[NoAdminRequired]
	public function collections(): JSONResponse {
		$uid = $this->uid();
		$out = [];
		foreach ($this->collections->findAllForUser($uid) as $c) {
			$out[] = $this->decorateShare($c->jsonSerialize(), true, null);
		}
		// collections other users have shared with me
		foreach ($this->shares->findForRecipient($uid) as $share) {
			try {
				$c = $this->collections->findById((int)$share->getCollectionId());
			} catch (DoesNotExistException $e) {
				continue; // stale share whose collection was deleted
			}
			$out[] = $this->decorateShare($c->jsonSerialize(), false, $share);
		}
		return new JSONResponse($out);
	}

	#[NoAdminRequired]
	public function createCollection(): JSONResponse {
		$name = trim((string)$this->request->getParam('name', ''));
		if ($name === '') {
			return new JSONResponse(['error' => 'Name is required'], Http::STATUS_BAD_REQUEST);
		}
		$c = new CollectionEntity();
		$c->setUserId($this->uid());
		$c->setName(mb_substr($name, 0, 255));
		$c->setIcon((string)$this->request->getParam('icon', '🧮'));
		$c->setColor((string)$this->request->getParam('color', '#2563eb'));
		$c->setDescription(mb_substr((string)$this->request->getParam('description', ''), 0, 2000));
		$c->setSort($this->collections->maxSort($this->uid()) + 1);
		$c->setCreatedAt($this->now());
		$c->setUpdatedAt($this->now());
		return new JSONResponse($this->collections->insert($c)->jsonSerialize());
	}

	#[NoAdminRequired]
	public function updateCollection(int $id): JSONResponse {
		try {
			// editing collection settings needs ownership or the 'delete' recipient level
			[$c, , $isOwner, $share] = $this->require($id, self::PERM_DELETE);
		} catch (ForbiddenException $e) {
			return $this->forbidden();
		} catch (DoesNotExistException $e) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		foreach (['name' => 'setName', 'icon' => 'setIcon', 'color' => 'setColor', 'description' => 'setDescription'] as $p => $setter) {
			$v = $this->request->getParam($p, null);
			if ($v !== null) {
				$c->$setter((string)$v);
			}
		}
		$sort = $this->request->getParam('sort', null);
		if ($sort !== null) {
			$c->setSort((int)$sort);
		}
		$c->setUpdatedAt($this->now());
		return new JSONResponse($this->decorateShare($this->collections->update($c)->jsonSerialize(), $isOwner, $share));
	}

	#[NoAdminRequired]
	public function deleteCollection(int $id): JSONResponse {
		// only the owner can delete a collection
		$c = $this->ownedCollection($id);
		if (!$c) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$this->shares->deleteForCollection($id);
		$this->historyMapper->deleteForCollection($id);
		$this->formulas->deleteForCollection($id);
		$this->collections->delete($c);
		return new JSONResponse(['ok' => true]);
	}

	/**
	 * Export a collection's formulas as an OpenDocument Spreadsheet (.ods).
	 * The file is hand-built with the core ZipArchive (no external library), matching
	 * RegiBase's dependency-free export approach, and streamed back as a download.
	 */
	#[NoAdminRequired]
	public function exportCollection(int $id): DataDownloadResponse|JSONResponse {
		try {
			[$c] = $this->resolve($id); // any access level may export
		} catch (DoesNotExistException $e) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$formulas = $this->formulas->findForCollection($id);
		$content = $this->buildOds($c, $formulas);
		$base = $this->sanitizeFilename($c->getName()) ?: 'collection';
		return new DataDownloadResponse(
			$content,
			$base . '.ods',
			'application/vnd.oasis.opendocument.spreadsheet'
		);
	}

	/** Strip path/reserved characters so the value is safe as a download filename. */
	private function sanitizeFilename(string $name): string {
		$name = str_replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|', "\0", "\r", "\n"], ' ', $name);
		$name = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
		return mb_substr($name, 0, 120);
	}

	private function mlEsc(string $s): string {
		return htmlspecialchars($s, ENT_QUOTES | ENT_XML1, 'UTF-8');
	}

	/** One ODS cell containing the given lines of text (each becomes a <text:p>). */
	private function odsTextCell(array $lines): string {
		$paras = '';
		foreach ($lines as $line) {
			$line = (string)$line;
			if ($line === '') {
				continue;
			}
			$paras .= '<text:p>' . $this->mlEsc($line) . '</text:p>';
		}
		return '<table:table-cell office:value-type="string">' . $paras . '</table:table-cell>';
	}

	/** One ODS cell holding a number. */
	private function odsNumberCell(float $value): string {
		$v = rtrim(rtrim(sprintf('%.10F', $value), '0'), '.');
		return '<table:table-cell office:value-type="float" office:value="' . $this->mlEsc($v) . '">'
			. '<text:p>' . $this->mlEsc($v) . '</text:p></table:table-cell>';
	}

	/** Render a formula's variable list as human-readable lines. */
	private function variableLines(array $vars): array {
		$lines = [];
		foreach ($vars as $v) {
			if (!is_array($v)) {
				continue;
			}
			$key = trim((string)($v['key'] ?? ''));
			$label = trim((string)($v['label'] ?? ''));
			$unit = trim((string)($v['unit'] ?? ''));
			$default = trim((string)($v['default'] ?? ''));
			if ($key === '' && $label === '') {
				continue;
			}
			$head = $label !== '' && $label !== $key ? ($label . ' (' . $key . ')') : ($key !== '' ? $key : $label);
			$extra = [];
			if ($default !== '') {
				$extra[] = '= ' . $default;
			}
			if ($unit !== '') {
				$extra[] = $unit;
			}
			$lines[] = $extra ? ($head . '  ' . implode(' ', $extra)) : $head;
		}
		return $lines;
	}

	/**
	 * Build a minimal, valid .ods (a ZIP of mimetype + content.xml + manifest + styles).
	 * The sheet lists one row per formula.
	 *
	 * @param FormulaEntity[] $formulas
	 */
	private function buildOds(CollectionEntity $c, array $formulas): string {
		$headers = [
			$this->l->t('Name'),
			$this->l->t('Expression'),
			$this->l->t('Variables'),
			$this->l->t('Result unit'),
			$this->l->t('Decimals'),
			$this->l->t('Notes'),
		];

		$rows = '';
		// Header row (bold style).
		$hcells = '';
		foreach ($headers as $h) {
			$hcells .= '<table:table-cell table:style-name="ceHead" office:value-type="string"><text:p>'
				. $this->mlEsc($h) . '</text:p></table:table-cell>';
		}
		$rows .= '<table:table-row>' . $hcells . '</table:table-row>';

		foreach ($formulas as $f) {
			$vars = json_decode((string)$f->getVariables(), true);
			$varLines = is_array($vars) ? $this->variableLines($vars) : [];
			$cells = ''
				. $this->odsTextCell([$f->getName()])
				. $this->odsTextCell([$f->getExpression()])
				. $this->odsTextCell($varLines)
				. $this->odsTextCell([(string)$f->getResultUnit()])
				. $this->odsNumberCell((float)$f->getDecimals())
				. $this->odsTextCell(preg_split('/\r\n|\r|\n/', (string)$f->getNotes()) ?: []);
			$rows .= '<table:table-row>' . $cells . '</table:table-row>';
		}

		$sheetName = $this->sanitizeFilename($c->getName());
		// ODS table names cannot contain ' or the chars we already stripped; keep it non-empty.
		$sheetName = str_replace("'", ' ', $sheetName);
		if ($sheetName === '') {
			$sheetName = 'Sheet1';
		}

		$content = '<?xml version="1.0" encoding="UTF-8"?>'
			. '<office:document-content'
			. ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
			. ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"'
			. ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"'
			. ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"'
			. ' xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"'
			. ' office:version="1.2">'
			. '<office:automatic-styles>'
			. '<style:style style:name="ceHead" style:family="table-cell">'
			. '<style:text-properties fo:font-weight="bold"/></style:style>'
			. '</office:automatic-styles>'
			. '<office:body><office:spreadsheet>'
			. '<table:table table:name="' . $this->mlEsc($sheetName) . '">'
			. '<table:table-column table:number-columns-repeated="6"/>'
			. $rows
			. '</table:table>'
			. '</office:spreadsheet></office:body></office:document-content>';

		$manifest = '<?xml version="1.0" encoding="UTF-8"?>'
			. '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
			. '<manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>'
			. '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
			. '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>'
			. '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>'
			. '</manifest:manifest>';

		$styles = '<?xml version="1.0" encoding="UTF-8"?>'
			. '<office:document-styles'
			. ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
			. ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"'
			. ' office:version="1.2"><office:styles/></office:document-styles>';

		$meta = '<?xml version="1.0" encoding="UTF-8"?>'
			. '<office:document-meta'
			. ' xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"'
			. ' xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"'
			. ' office:version="1.2"><office:meta>'
			. '<meta:generator>FormulaBase</meta:generator>'
			. '</office:meta></office:document-meta>';

		$tmp = $this->tempManager->getTemporaryFile('.ods');
		$zip = new \ZipArchive();
		$zip->open($tmp, \ZipArchive::CREATE | \ZipArchive::OVERWRITE);
		// The 'mimetype' entry must be first and stored uncompressed per the ODF spec.
		$zip->addFromString('mimetype', 'application/vnd.oasis.opendocument.spreadsheet');
		$zip->setCompressionName('mimetype', \ZipArchive::CM_STORE);
		$zip->addFromString('content.xml', $content);
		$zip->addFromString('styles.xml', $styles);
		$zip->addFromString('meta.xml', $meta);
		$zip->addFromString('META-INF/manifest.xml', $manifest);
		$zip->close();
		$bytes = (string)file_get_contents($tmp);
		@unlink($tmp);
		return $bytes;
	}

	#[NoAdminRequired]
	public function formulas(int $id): JSONResponse {
		try {
			$this->resolve($id); // any access level may read the formulas
		} catch (DoesNotExistException $e) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$out = array_map(fn ($f) => $f->jsonSerialize(), $this->formulas->findForCollection($id));
		return new JSONResponse($out);
	}

	#[NoAdminRequired]
	public function createFormula(int $id): JSONResponse {
		try {
			$this->require($id, self::PERM_EDIT);
		} catch (ForbiddenException $e) {
			return $this->forbidden();
		} catch (DoesNotExistException $e) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$f = new FormulaEntity();
		$f->setCollectionId($id);
		$this->applyFormulaParams($f);
		$f->setSort($this->formulas->maxSort($id) + 1);
		$f->setCreatedAt($this->now());
		$f->setUpdatedAt($this->now());
		return new JSONResponse($this->formulas->insert($f)->jsonSerialize());
	}

	#[NoAdminRequired]
	public function updateFormula(int $id): JSONResponse {
		try {
			$f = $this->formulas->find($id);
			$this->require($f->getCollectionId(), self::PERM_EDIT);
		} catch (ForbiddenException $e) {
			return $this->forbidden();
		} catch (DoesNotExistException $e) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$this->applyFormulaParams($f);
		$f->setUpdatedAt($this->now());
		return new JSONResponse($this->formulas->update($f)->jsonSerialize());
	}

	#[NoAdminRequired]
	public function deleteFormula(int $id): JSONResponse {
		try {
			$f = $this->formulas->find($id);
			$this->require($f->getCollectionId(), self::PERM_DELETE);
		} catch (ForbiddenException $e) {
			return $this->forbidden();
		} catch (DoesNotExistException $e) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$this->historyMapper->clearForFormula($this->uid(), $f->getId());
		$this->formulas->delete($f);
		return new JSONResponse(['ok' => true]);
	}

	/** @return FormulaEntity|null the formula if it exists and the user can at least view its collection */
	private function resolvedFormula(int $id): ?FormulaEntity {
		try {
			$f = $this->formulas->find($id);
			$this->resolve($f->getCollectionId());
			return $f;
		} catch (DoesNotExistException $e) {
			return null;
		}
	}

	#[NoAdminRequired]
	public function history(int $id): JSONResponse {
		if (!$this->resolvedFormula($id)) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$out = array_map(fn ($h) => $h->jsonSerialize(), $this->historyMapper->findForFormula($this->uid(), $id, 50));
		return new JSONResponse($out);
	}

	#[NoAdminRequired]
	public function addHistory(int $id): JSONResponse {
		$f = $this->resolvedFormula($id);
		if (!$f) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$inputs = $this->request->getParam('inputs', []);
		$h = new HistoryEntity();
		$h->setUserId($this->uid());
		$h->setFormulaId($id);
		$h->setCollectionId($f->getCollectionId());
		$h->setInputs(is_string($inputs) ? $inputs : json_encode((object)$inputs));
		$h->setLabel((string)$this->request->getParam('label', ''));
		$h->setResult(mb_substr((string)$this->request->getParam('result', ''), 0, 64));
		$h->setUnit(mb_substr((string)$this->request->getParam('unit', ''), 0, 32));
		$h->setCreatedAt($this->now());
		$saved = $this->historyMapper->insert($h);
		$this->historyMapper->trim($this->uid(), $id, 50);
		return new JSONResponse($saved->jsonSerialize());
	}

	#[NoAdminRequired]
	public function clearHistory(int $id): JSONResponse {
		// history is per-user, so clearing only affects the caller's own entries
		if (!$this->resolvedFormula($id)) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$this->historyMapper->clearForFormula($this->uid(), $id);
		return new JSONResponse(['ok' => true]);
	}

	#[NoAdminRequired]
	public function deleteHistoryEntry(int $id): JSONResponse {
		try {
			$h = $this->historyMapper->find($id);
		} catch (DoesNotExistException $e) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		if ($h->getUserId() !== $this->uid()) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$this->historyMapper->delete($h);
		return new JSONResponse(['ok' => true]);
	}

	/* ---- internal collection sharing (permission-only, no encryption) ---- */

	#[NoAdminRequired]
	public function searchUsers(): JSONResponse {
		$q = trim((string)$this->request->getParam('q', ''));
		$me = $this->uid();
		if (mb_strlen($q) < 1) {
			return new JSONResponse(['users' => []]);
		}
		$found = [];
		foreach ($this->userManager->searchDisplayName($q, 25) as $u) {
			$found[$u->getUID()] = $u->getDisplayName();
		}
		foreach ($this->userManager->search($q, 25) as $u) {
			$found[$u->getUID()] = $u->getDisplayName();
		}
		$users = [];
		foreach ($found as $uid => $name) {
			if ($uid === $me) {
				continue;
			}
			$users[] = ['uid' => $uid, 'name' => $name];
			if (count($users) >= 20) {
				break;
			}
		}
		return new JSONResponse(['users' => $users]);
	}

	#[NoAdminRequired]
	public function collectionShares(int $id): JSONResponse {
		if (!$this->ownedCollection($id)) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$shares = array_map(fn (ShareEntity $s) => $s->jsonSerialize(), $this->shares->findForCollection($id));
		foreach ($shares as &$s) {
			$s['recipient_name'] = $this->displayName((string)$s['recipient_uid']);
		}
		return new JSONResponse(['shares' => $shares]);
	}

	#[NoAdminRequired]
	public function addShare(int $id): JSONResponse {
		if (!$this->ownedCollection($id)) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$recipient = trim((string)$this->request->getParam('recipient', ''));
		$perm = (string)$this->request->getParam('perm', 'view');
		if (!isset(self::PERM_RANK[$perm])) {
			$perm = self::PERM_VIEW;
		}
		if ($recipient === '' || $this->userManager->get($recipient) === null) {
			return new JSONResponse(['error' => $this->l->t('No such user')], Http::STATUS_BAD_REQUEST);
		}
		if ($recipient === $this->uid()) {
			return new JSONResponse(['error' => $this->l->t('Cannot share with yourself')], Http::STATUS_BAD_REQUEST);
		}
		if ($this->shares->findOne($id, $recipient) !== null) {
			return new JSONResponse(['error' => $this->l->t('Already shared with this user')], Http::STATUS_BAD_REQUEST);
		}
		$s = new ShareEntity();
		$s->setCollectionId($id);
		$s->setOwnerUid($this->uid());
		$s->setRecipientUid($recipient);
		$s->setPerm($perm);
		$s->setCreatedAt($this->now());
		$j = $this->shares->insert($s)->jsonSerialize();
		$j['recipient_name'] = $this->displayName($recipient);
		return new JSONResponse($j, Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	public function updateShare(int $id, string $uid): JSONResponse {
		if (!$this->ownedCollection($id)) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$s = $this->shares->findOne($id, $uid);
		if ($s === null) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$perm = $this->request->getParam('perm', null);
		if ($perm !== null && isset(self::PERM_RANK[(string)$perm])) {
			$s->setPerm((string)$perm);
			$this->shares->update($s);
		}
		$j = $s->jsonSerialize();
		$j['recipient_name'] = $this->displayName($uid);
		return new JSONResponse($j);
	}

	#[NoAdminRequired]
	public function removeShare(int $id, string $uid): JSONResponse {
		if (!$this->ownedCollection($id)) {
			return new JSONResponse(['error' => 'Not found'], Http::STATUS_NOT_FOUND);
		}
		$s = $this->shares->findOne($id, $uid);
		if ($s !== null) {
			$this->shares->delete($s);
		}
		return new JSONResponse(['ok' => true]);
	}

	/* ---- full backup / restore (all collections + formulas) ---- */

	/**
	 * Download every collection and formula as a ZIP.
	 * A password is optional: when given, the archive is AES-256 encrypted with it;
	 * when empty, a plain (unencrypted) ZIP is produced. FormulaBase has no
	 * attachments and no field-level encryption, so the archive is just data.json.
	 */
	#[NoAdminRequired]
	public function backup(): JSONResponse|DataDownloadResponse {
		$uid = $this->uid();
		$password = (string)$this->request->getParam('password', '');
		$struct = $this->exportAllData($uid);

		$tmp = $this->tempManager->getTemporaryFile('.zip');
		$zip = new \ZipArchive();
		if ($zip->open($tmp, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
			return new JSONResponse(['error' => $this->l->t('Failed to create the backup')], Http::STATUS_INTERNAL_SERVER_ERROR);
		}
		if ($password !== '') {
			$zip->setPassword($password);
		}
		$zip->addFromString('data.json', (string)json_encode($struct, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
		if ($password !== '') {
			$zip->setEncryptionName('data.json', \ZipArchive::EM_AES_256);
		}
		$zip->close();
		$content = (string)file_get_contents($tmp);
		@unlink($tmp);

		$safeUid = preg_replace('/[^A-Za-z0-9._-]+/', '_', $uid);
		$fname = 'FormulaBase-' . $safeUid . '_' . gmdate('Ymd') . '_backup.zip';
		return new DataDownloadResponse($content, $fname, 'application/zip');
	}

	/**
	 * Restore a backup ZIP (base64 in the JSON body as `dataUrl`).
	 * `password` is only needed when the archive was created with one.
	 * `mode`: overwrite | merge | add.
	 */
	#[NoAdminRequired]
	public function restore(): JSONResponse {
		$uid = $this->uid();
		$password = (string)$this->request->getParam('password', '');
		$dataUrl = (string)$this->request->getParam('dataUrl', '');
		$mode = (string)$this->request->getParam('mode', 'overwrite');
		if (!in_array($mode, ['overwrite', 'merge', 'add'], true)) {
			$mode = 'overwrite';
		}
		$b64 = $dataUrl;
		if (($p = strpos($b64, 'base64,')) !== false) {
			$b64 = substr($b64, $p + 7);
		}
		$bin = base64_decode($b64, true);
		if ($bin === false || $bin === '') {
			return new JSONResponse(['error' => $this->l->t('The archive is invalid')], Http::STATUS_BAD_REQUEST);
		}
		$tmp = $this->tempManager->getTemporaryFile('.zip');
		file_put_contents($tmp, $bin);
		$zip = new \ZipArchive();
		if ($zip->open($tmp) !== true) {
			@unlink($tmp);
			return new JSONResponse(['error' => $this->l->t('Cannot open the archive')], Http::STATUS_BAD_REQUEST);
		}
		if ($password !== '') {
			$zip->setPassword($password);
		}
		$json = $zip->getFromName('data.json');
		if ($json === false) {
			$zip->close();
			@unlink($tmp);
			return new JSONResponse(['error' => $this->l->t('Wrong password or corrupted archive')], Http::STATUS_FORBIDDEN);
		}
		$zip->close();
		@unlink($tmp);

		$struct = json_decode($json, true);
		if (!is_array($struct) || !isset($struct['collections'])) {
			return new JSONResponse(['error' => $this->l->t('The archive contents are invalid')], Http::STATUS_BAD_REQUEST);
		}

		if ($mode === 'overwrite' && is_array($struct['settings'] ?? null)) {
			$s = $struct['settings'];
			foreach (['theme', 'language'] as $k) {
				if (array_key_exists($k, $s)) {
					$v = (string)$s[$k];
					if ($k === 'theme' && !in_array($v, self::ALLOWED_THEMES, true)) {
						continue;
					}
					$this->config->setUserValue($uid, Application::APP_ID, $k, $v);
				}
			}
		}

		$result = $this->importAllData($uid, $struct, $mode);
		return new JSONResponse($result);
	}

	/** Everything needed to reconstruct the user's collections and formulas. */
	private function exportAllData(string $uid): array {
		$collections = [];
		foreach ($this->collections->findAllForUser($uid) as $c) {
			$cj = $c->jsonSerialize();
			$formulas = [];
			foreach ($this->formulas->findForCollection((int)$c->getId()) as $f) {
				$fj = $f->jsonSerialize();
				$formulas[] = [
					'name' => $fj['name'] ?? '',
					'expression' => $fj['expression'] ?? '',
					'description' => $fj['description'] ?? '',
					'variables' => $fj['variables'] ?? [],
					'result_unit' => $fj['result_unit'] ?? '',
					'decimals' => (int)($fj['decimals'] ?? 2),
					'notes' => $fj['notes'] ?? '',
				];
			}
			$collections[] = [
				'name' => $cj['name'] ?? '',
				'icon' => $cj['icon'] ?? '🧮',
				'color' => $cj['color'] ?? '#2563eb',
				'description' => $cj['description'] ?? '',
				'formulas' => $formulas,
			];
		}
		return [
			'app' => 'FormulaBase',
			'backup_version' => 1,
			'exported_at' => $this->now(),
			'collections' => $collections,
			'settings' => [
				'theme' => $this->config->getUserValue($uid, Application::APP_ID, 'theme', 'auto'),
				'language' => $this->config->getUserValue($uid, Application::APP_ID, 'language', 'auto'),
			],
		];
	}

	/** Duplicate-detection signature for a formula: name + expression + variables. */
	private function formulaSignature(array $f): string {
		$vars = $f['variables'] ?? [];
		if (!is_string($vars)) {
			$vars = json_encode($vars, JSON_UNESCAPED_UNICODE);
		}
		return (string)json_encode([
			trim((string)($f['name'] ?? '')),
			trim((string)($f['expression'] ?? '')),
			$vars,
		], JSON_UNESCAPED_UNICODE);
	}

	private function insertFormulaFromArray(int $cid, array $f, int $sort): void {
		$e = new FormulaEntity();
		$e->setCollectionId($cid);
		$e->setName(mb_substr(trim((string)($f['name'] ?? '')), 0, 255));
		$e->setExpression((string)($f['expression'] ?? ''));
		$e->setDescription(mb_substr((string)($f['description'] ?? ''), 0, 5000));
		$vars = $f['variables'] ?? [];
		$e->setVariables(is_string($vars) ? $vars : json_encode(array_values((array)$vars), JSON_UNESCAPED_UNICODE));
		$e->setResultUnit(mb_substr((string)($f['result_unit'] ?? ''), 0, 32));
		$e->setDecimals(max(0, min(10, (int)($f['decimals'] ?? 2))));
		$e->setNotes((string)($f['notes'] ?? ''));
		$e->setSort($sort);
		$e->setCreatedAt($this->now());
		$e->setUpdatedAt($this->now());
		$this->formulas->insert($e);
	}

	/**
	 * Recreate collections/formulas from a backup struct.
	 * overwrite = wipe then restore; merge = add non-duplicate formulas into a
	 * same-named collection; add = always create new collections.
	 */
	private function importAllData(string $uid, array $struct, string $mode): array {
		if ($mode === 'overwrite') {
			foreach ($this->collections->findAllForUser($uid) as $c) {
				$cid = (int)$c->getId();
				$this->historyMapper->deleteForCollection($cid);
				$this->formulas->deleteForCollection($cid);
				$this->collections->delete($c);
			}
		}

		// merge: index existing collections by name + their formula signatures.
		$existingByName = [];
		if ($mode === 'merge') {
			foreach ($this->collections->findAllForUser($uid) as $c) {
				$cid = (int)$c->getId();
				$sigs = [];
				foreach ($this->formulas->findForCollection($cid) as $f) {
					$sigs[$this->formulaSignature($f->jsonSerialize())] = true;
				}
				$name = (string)$c->getName();
				if (!isset($existingByName[$name])) {
					$existingByName[$name] = ['id' => $cid, 'sigs' => $sigs];
				}
			}
		}

		$colCount = 0;
		$formCount = 0;
		foreach (($struct['collections'] ?? []) as $col) {
			$name = (string)($col['name'] ?? 'FormulaBase');
			$formulas = is_array($col['formulas'] ?? null) ? $col['formulas'] : [];

			if ($mode === 'merge' && isset($existingByName[$name])) {
				$cid = $existingByName[$name]['id'];
				$sort = $this->formulas->maxSort($cid);
				foreach ($formulas as $f) {
					$sig = $this->formulaSignature($f);
					if (isset($existingByName[$name]['sigs'][$sig])) {
						continue;
					}
					$existingByName[$name]['sigs'][$sig] = true;
					$this->insertFormulaFromArray($cid, $f, ++$sort);
					$formCount++;
				}
				continue;
			}

			$c = new CollectionEntity();
			$c->setUserId($uid);
			$c->setName(mb_substr($name, 0, 255));
			$c->setIcon((string)($col['icon'] ?? '🧮'));
			$c->setColor((string)($col['color'] ?? '#2563eb'));
			$c->setDescription(mb_substr((string)($col['description'] ?? ''), 0, 2000));
			$c->setSort($this->collections->maxSort($uid) + 1);
			$c->setCreatedAt($this->now());
			$c->setUpdatedAt($this->now());
			$cid = (int)$this->collections->insert($c)->getId();
			$sort = 0;
			foreach ($formulas as $f) {
				$this->insertFormulaFromArray($cid, $f, ++$sort);
				$formCount++;
			}
			$colCount++;
		}
		return ['collections' => $colCount, 'formulas' => $formCount, 'mode' => $mode];
	}

	private function applyFormulaParams(FormulaEntity $f): void {
		$name = $this->request->getParam('name', null);
		if ($name !== null) {
			$f->setName(mb_substr(trim((string)$name), 0, 255));
		}
		$expr = $this->request->getParam('expression', null);
		if ($expr !== null) {
			$f->setExpression((string)$expr);
		}
		$desc = $this->request->getParam('description', null);
		if ($desc !== null) {
			$f->setDescription(mb_substr((string)$desc, 0, 5000));
		}
		$vars = $this->request->getParam('variables', null);
		if ($vars !== null) {
			// Accept an array (from JSON body) or a pre-encoded string; store as JSON text.
			$f->setVariables(is_string($vars) ? $vars : json_encode(array_values((array)$vars)));
		}
		$unit = $this->request->getParam('result_unit', null);
		if ($unit !== null) {
			$f->setResultUnit(mb_substr((string)$unit, 0, 32));
		}
		$dec = $this->request->getParam('decimals', null);
		if ($dec !== null) {
			$f->setDecimals(max(0, min(10, (int)$dec)));
		}
		$notes = $this->request->getParam('notes', null);
		if ($notes !== null) {
			$f->setNotes((string)$notes);
		}
	}
}
