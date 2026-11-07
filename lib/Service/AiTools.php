<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Service;

use OCA\FormulaBase\AppInfo\Application;
use OCA\FormulaBase\Db\CollectionEntity;
use OCA\FormulaBase\Db\CollectionMapper;
use OCA\FormulaBase\Db\FormulaEntity;
use OCA\FormulaBase\Db\FormulaMapper;
use OCA\FormulaBase\Db\HistoryMapper;
use OCA\FormulaBase\Db\ShareMapper;
use OCP\AppFramework\Db\DoesNotExistException;
use OCP\IConfig;
use OCP\L10N\IFactory;

/**
 * What the assistant can do inside FormulaBase by itself (the owner, 2026-11-07: RegiBase's
 * assistant was made able to work in the app, "修正しろ" for the other apps too).
 *
 * The tools act with the rights of the person asking, by the same rules as the page
 * (ApiController::resolve()/require()): a collection shared to them only at its level --
 * view to read, edit to add and change formulas, delete to delete formulas and change the
 * collection's settings -- and only the owner deletes a collection.
 *
 * Taking back: a formula the assistant changes is kept as a version first (whatever the owner's
 * version settings), so "Versions" brings it back. FormulaBase has no undo of a deletion, so a
 * formula or collection the assistant deletes is kept in the person's "deleted by the assistant"
 * list (the last DELETED_KEEP), and restore_deleted puts it back.
 *
 * FormulaBase holds no secret values: nothing here is hidden from the assistant.
 */
class AiTools {
	private const OUT_MAX = 60000;
	private const PERM_RANK = ['view' => 1, 'edit' => 2, 'delete' => 3];
	private const DELETED_KEY = 'ai_deleted';
	private const DELETED_KEEP = 30;

	public function __construct(
		private CollectionMapper $collections,
		private FormulaMapper $formulas,
		private ShareMapper $shares,
		private HistoryMapper $history,
		private FormulaVersionService $versions,
		private FormulaCompiler $compiler,
		private IConfig $config,
		private IFactory $l10nFactory,
	) {
	}

	/** In the asker's language: AI-Hub runs the tools in a request of its own, without theirs. */
	private function l(string $uid = ''): \OCP\IL10N {
		$lang = $uid !== '' ? $this->config->getUserValue($uid, 'core', 'lang', '') : '';
		return $lang !== '' ? $this->l10nFactory->get(Application::APP_ID, $lang) : $this->l10nFactory->get(Application::APP_ID);
	}

	/** What a change did, for the list shown under the answer: "label — n: names". */
	private static function report(string $label, array $names, int $n = -1): string {
		$n = $n < 0 ? count($names) : $n;
		$names = array_values(array_filter(array_map(fn ($x) => trim((string)$x), $names), fn ($x) => $x !== ''));
		$shown = array_slice($names, 0, 20);
		return $label . ' — ' . $n . ($shown !== [] ? ': ' . implode(', ', $shown) . (count($names) > 20 ? ', …' : '') : '');
	}

	private function failedPart(string $uid, array $failed): string {
		return $failed !== [] ? ' / ' . $this->l($uid)->t('Failed') . ' — ' . count($failed) : '';
	}

	/** @param callable(): list<string> $allowed What the administrator allows (AiService::SOURCES). */
	public function tools(callable $allowed): array {
		$wrap = function (string $need, callable $fn) use ($allowed): callable {
			return function (string $uid, array $args) use ($need, $fn, $allowed) {
				if (!in_array($need, $allowed(), true)) {
					return ['error' => $need === 'write'
						? 'The administrator has not allowed the assistant to change anything in FormulaBase.'
						: 'The administrator has not allowed the assistant to read this.'];
				}
				try {
					$out = $fn($uid, $args);
				} catch (ForbiddenException $e) {
					$out = ['error' => 'The person asking does not have the right to do that (the level a collection was shared at, or not the owner).'];
				} catch (DoesNotExistException $e) {
					$out = ['error' => 'Not found, or not one the person can see.'];
				} catch (\InvalidArgumentException|\RuntimeException $e) {
					$out = ['error' => $e->getMessage()];
				}
				$json = json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
				return mb_strlen($json) > self::OUT_MAX ? mb_substr($json, 0, self::OUT_MAX) . ' …(cut: ask for fewer)' : $json;
			};
		};
		$ids = ['type' => 'array', 'items' => ['type' => 'integer']];
		$l = $this->l();
		$formulaShape = 'Each formula is {name, expression, description, variables: [{key, label, unit, type (number, list, matrix or complex), default}], result_unit, decimals (0-10), notes}.';
		return [
			'list_collections' => [
				'kind' => 'read',
				'label' => $l->t('Look at the collections'),
				'description' => 'Every collection the person can see: id, name, icon, number of formulas, and whether it is theirs or shared to them (and at what level).',
				'input' => ['type' => 'object', 'properties' => new \stdClass()],
				'run' => $wrap('collection', fn ($uid) => $this->listCollections($uid)),
			],
			'find_formulas' => [
				'kind' => 'read',
				'label' => $l->t('Find formulas'),
				'description' => 'Formulas of the given collections (all the person can see when left out), each with its id, collection, name, expression, variables, result unit, decimals, description and notes. query: words that must all appear in the name, expression, description or notes (case ignored). Up to limit (default 100, at most 300).',
				'input' => ['type' => 'object', 'properties' => ['collection_ids' => $ids, 'query' => ['type' => 'string'], 'limit' => ['type' => 'integer']]],
				'run' => $wrap('collection', fn ($uid, $a) => $this->findFormulas($uid, $a)),
			],
			'calculate' => [
				'kind' => 'read',
				'label' => $l->t('Work out a formula'),
				'description' => 'Work out a formula: either formula_id (a saved formula) or expression with variables, and values {variable key: value} (numbers, or text for lists "1, 2, 3", matrices "1, 2; 3, 4", complex "3+4i"). A missing value takes the variable\'s default. Returns the result, or the error the expression gives. Use it to check a formula before saving it.',
				'input' => ['type' => 'object', 'properties' => ['formula_id' => ['type' => 'integer'], 'expression' => ['type' => 'string'],
					'variables' => ['type' => 'array', 'items' => ['type' => 'object']], 'values' => ['type' => 'object']]],
				'run' => $wrap('collection', fn ($uid, $a) => $this->calculate($uid, $a)),
			],
			'search_templates' => [
				'kind' => 'read',
				'label' => $l->t('Search the templates'),
				'description' => 'Search the built-in templates (5,500+) by words in their name or field (English or the person\'s language). Returns up to limit (default 30, at most 100): name (the English name, used to add it), name in the person\'s language, field, expression, variables.',
				'input' => ['type' => 'object', 'properties' => ['query' => ['type' => 'string'], 'limit' => ['type' => 'integer']], 'required' => ['query']],
				'run' => $wrap('templates', fn ($uid, $a) => $this->searchTemplates($uid, $a)),
			],
			'add_templates' => [
				'kind' => 'create',
				'label' => $l->t('Add templates'),
				'description' => 'Add built-in templates to a collection as the person\'s own formulas, in the person\'s language: names is a list of template names exactly as search_templates gave them (the English name). Up to 50 at once.',
				'input' => ['type' => 'object', 'properties' => ['collection_id' => ['type' => 'integer'], 'names' => ['type' => 'array', 'items' => ['type' => 'string']]], 'required' => ['collection_id', 'names']],
				'run' => $wrap('write', fn ($uid, $a) => $this->addTemplates($uid, (int)$a['collection_id'], (array)$a['names'])),
			],
			'create_formulas' => [
				'kind' => 'create',
				'label' => $l->t('Add formulas'),
				'description' => 'Add formulas to a collection. ' . $formulaShape . ' The expression is checked first; one that does not parse is refused with the reason. Up to 50 at once.',
				'input' => ['type' => 'object', 'properties' => ['collection_id' => ['type' => 'integer'], 'formulas' => ['type' => 'array', 'items' => ['type' => 'object']]], 'required' => ['collection_id', 'formulas']],
				'run' => $wrap('write', fn ($uid, $a) => $this->createFormulas($uid, (int)$a['collection_id'], (array)$a['formulas'])),
			],
			'update_formulas' => [
				'kind' => 'update',
				'label' => $l->t('Change formulas'),
				'description' => 'Change formulas: updates is a list of {id, and only the fields to change: name, expression, description, variables (the whole list), result_unit, decimals, notes}. The formula as it was is kept as a version first, so "Versions" on its card brings it back. Up to 50 at once.',
				'input' => ['type' => 'object', 'properties' => ['updates' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => ['id' => ['type' => 'integer']], 'required' => ['id']]]], 'required' => ['updates']],
				'run' => $wrap('write', fn ($uid, $a) => $this->updateFormulas($uid, (array)$a['updates'])),
			],
			'delete_formulas' => [
				'kind' => 'delete',
				'label' => $l->t('Delete formulas'),
				'description' => 'Delete formulas by id, with their calculation history. Each is kept in the person\'s list of what the assistant deleted, and restore_deleted puts it back (without its history and versions).',
				'input' => ['type' => 'object', 'properties' => ['ids' => $ids], 'required' => ['ids']],
				'run' => $wrap('write', fn ($uid, $a) => $this->deleteFormulas($uid, array_map('intval', (array)$a['ids']))),
			],
			'create_collection' => [
				'kind' => 'create',
				'label' => $l->t('Make a collection'),
				'description' => 'Make a collection of the person\'s own: name, icon (one emoji), color (#rrggbb), description.',
				'input' => ['type' => 'object', 'properties' => ['name' => ['type' => 'string'], 'icon' => ['type' => 'string'], 'color' => ['type' => 'string'], 'description' => ['type' => 'string']], 'required' => ['name']],
				'run' => $wrap('write', fn ($uid, $a) => $this->createCollection($uid, $a)),
			],
			'update_collection' => [
				'kind' => 'update',
				'label' => $l->t('Change a collection'),
				'description' => 'Change a collection\'s name, icon, color or description (the owner, or the delete level of a share). Only what is given changes.',
				'input' => ['type' => 'object', 'properties' => ['id' => ['type' => 'integer'], 'name' => ['type' => 'string'], 'icon' => ['type' => 'string'], 'color' => ['type' => 'string'], 'description' => ['type' => 'string']], 'required' => ['id']],
				'run' => $wrap('write', fn ($uid, $a) => $this->updateCollection($uid, $a)),
			],
			'delete_collection' => [
				'kind' => 'delete',
				'label' => $l->t('Delete a collection'),
				'description' => 'Delete a collection of the person\'s own with its formulas, their history and its shares. It is kept with its formulas in the list of what the assistant deleted, and restore_deleted brings it back (without history, versions and shares).',
				'input' => ['type' => 'object', 'properties' => ['id' => ['type' => 'integer']], 'required' => ['id']],
				'run' => $wrap('write', fn ($uid, $a) => $this->deleteCollection($uid, (int)$a['id'])),
			],
			'restore_deleted' => [
				'kind' => 'create',
				'label' => $l->t('Bring back what was deleted'),
				'description' => 'The formulas and collections the assistant deleted for this person (newest first): without arguments, list them; with numbers (from that list), put those back.',
				'input' => ['type' => 'object', 'properties' => ['numbers' => $ids]],
				'run' => $wrap('write', fn ($uid, $a) => $this->restoreDeleted($uid, array_map('intval', (array)($a['numbers'] ?? [])))),
			],
		];
	}

	// ---- rights, as the page has them ----

	/** @return array{0: CollectionEntity, 1: string, 2: bool} collection, level, owner */
	private function resolve(string $uid, int $id): array {
		try {
			return [$this->collections->findForUser($id, $uid), 'owner', true];
		} catch (DoesNotExistException $e) {
		}
		$share = $this->shares->findOne($id, $uid);
		if ($share === null) {
			throw new DoesNotExistException('no access');
		}
		return [$this->collections->findById($id), (string)$share->getPerm(), false];
	}

	private function need(string $uid, int $id, string $min): CollectionEntity {
		[$c, $perm, $owner] = $this->resolve($uid, $id);
		if (!$owner && (self::PERM_RANK[$perm] ?? 0) < (self::PERM_RANK[$min] ?? 99)) {
			throw new ForbiddenException('permission denied');
		}
		return $c;
	}

	private static function now(): string {
		return gmdate('Y-m-d\TH:i:s\Z');
	}

	// ---- reading ----

	/** id => [collection, level] */
	private function visible(string $uid): array {
		$out = [];
		foreach ($this->collections->findAllForUser($uid) as $c) {
			$out[(int)$c->getId()] = [$c, 'own'];
		}
		foreach ($this->shares->findForRecipient($uid) as $s) {
			try {
				$out[(int)$s->getCollectionId()] = [$this->collections->findById((int)$s->getCollectionId()), 'shared to them (' . $s->getPerm() . ')'];
			} catch (DoesNotExistException $e) {
			}
		}
		return $out;
	}

	private function listCollections(string $uid): array {
		$out = [];
		foreach ($this->visible($uid) as $id => [$c, $level]) {
			$out[] = ['id' => $id, 'name' => $c->getName(), 'icon' => $c->getIcon(), 'description' => (string)$c->getDescription(),
				'formulas' => count($this->formulas->findForCollection($id)), 'owner' => $level];
		}
		return ['collections' => $out];
	}

	private static function formulaOut(FormulaEntity $f, string $collName = ''): array {
		$j = $f->jsonSerialize();
		unset($j['sort'], $j['created_at']);
		if ($collName !== '') {
			$j['collection_name'] = $collName;
		}
		return $j;
	}

	private function findFormulas(string $uid, array $a): array {
		$visible = $this->visible($uid);
		$ids = is_array($a['collection_ids'] ?? null) && $a['collection_ids'] !== [] ? array_map('intval', $a['collection_ids']) : array_keys($visible);
		$words = array_filter(explode(' ', mb_strtolower(trim((string)($a['query'] ?? '')))), fn ($w) => $w !== '');
		$rows = [];
		foreach ($ids as $cid) {
			if (!isset($visible[$cid])) {
				throw new DoesNotExistException('not visible');
			}
			foreach ($this->formulas->findForCollection($cid) as $f) {
				$text = mb_strtolower($f->getName() . ' ' . $f->getExpression() . ' ' . $f->getDescription() . ' ' . $f->getNotes());
				foreach ($words as $w) {
					if (!str_contains($text, $w)) {
						continue 2;
					}
				}
				$rows[] = self::formulaOut($f, $visible[$cid][0]->getName());
			}
		}
		$limit = max(1, min(300, (int)($a['limit'] ?? 100)));
		return ['total' => count($rows), 'formulas' => array_slice($rows, 0, $limit)];
	}

	private function calculate(string $uid, array $a): array {
		if (isset($a['formula_id'])) {
			$f = $this->formulas->find((int)$a['formula_id']);
			$this->resolve($uid, (int)$f->getCollectionId());
			$expr = (string)$f->getExpression();
			$vars = json_decode((string)$f->getVariables(), true) ?: [];
		} else {
			$expr = (string)($a['expression'] ?? '');
			$vars = is_array($a['variables'] ?? null) ? $a['variables'] : [];
		}
		if (trim($expr) === '') {
			throw new \InvalidArgumentException('Give formula_id, or an expression.');
		}
		$values = is_array($a['values'] ?? null) ? $a['values'] : [];
		try {
			$ast = $this->compiler->parse($expr);
		} catch (\Throwable $e) {
			return ['ok' => false, 'error' => 'The expression does not parse: ' . $e->getMessage()];
		}
		$scope = [];
		$byKey = [];
		foreach ($vars as $v) {
			if (is_array($v) && trim((string)($v['key'] ?? '')) !== '') {
				$byKey[trim((string)$v['key'])] = $v;
			}
		}
		foreach ($values as $k => $_) {
			if (!isset($byKey[$k])) {
				$byKey[(string)$k] = ['key' => (string)$k];
			}
		}
		foreach ($byKey as $k => $v) {
			$raw = $values[$k] ?? null;
			if (FormulaCompiler::variableKind($v + (is_string($raw) ? ['default' => $raw] : [])) === 'number') {
				$scope[$k] = is_numeric($raw) ? (float)$raw : (is_numeric($v['default'] ?? null) ? (float)$v['default'] : 0.0);
			} else {
				$scope[$k] = $this->compiler->parseValue(is_string($raw) && trim($raw) !== '' ? $raw : (string)($v['default'] ?? ''));
			}
		}
		try {
			$r = $this->compiler->evaluate($ast, $scope);
		} catch (\Throwable $e) {
			return ['ok' => false, 'error' => $e->getMessage()];
		}
		return ['ok' => true, 'result' => $this->compiler->formatValue($r)];
	}

	private function lang(string $uid): string {
		$lang = $this->config->getUserValue($uid, Application::APP_ID, 'language', 'auto');
		$lang = Application::OLD_LANGUAGES[$lang] ?? $lang;
		if ($lang === 'auto' || $lang === '') {
			$lang = $this->config->getUserValue($uid, 'core', 'lang', 'en') ?: 'en';
		}
		return $lang;
	}

	/** @var array<string, array<string, string>> */
	private array $tr = [];

	/**
	 * The person's language's text for an English template string, as the page shows it. Read from
	 * the l10n file itself: IL10N::t() runs the text through vsprintf(), and a template such as
	 * "Percent of a total (%)" made it throw.
	 * @return callable(mixed): string
	 */
	private function translator(string $uid): callable {
		$lang = $this->lang($uid);
		if (!isset($this->tr[$lang])) {
			$file = dirname(__DIR__, 2) . '/l10n/' . basename($lang) . '.json';
			$json = is_readable($file) ? json_decode((string)file_get_contents($file), true) : null;
			$this->tr[$lang] = is_array($json['translations'] ?? null) ? array_filter($json['translations'], 'is_string') : [];
		}
		$map = $this->tr[$lang];
		return static fn ($s): string => is_string($s) && $s !== '' ? ($map[$s] ?? $s) : '';
	}

	private function templateDir(): string {
		return dirname(__DIR__, 2) . '/data/templates';
	}

	private function searchTemplates(string $uid, array $a): array {
		$t = $this->translator($uid);
		$index = json_decode((string)@file_get_contents($this->templateDir() . '/index.json'), true) ?: [];
		$words = array_filter(explode(' ', mb_strtolower(trim((string)$a['query']))), fn ($w) => $w !== '');
		$out = [];
		$limit = max(1, min(100, (int)($a['limit'] ?? 30)));
		foreach ($index as $tp) {
			$local = $t((string)$tp['name']);
			$text = mb_strtolower($tp['name'] . ' ' . $local . ' ' . ($tp['cat'] ?? '') . ' ' . $t((string)($tp['cat'] ?? '')));
			foreach ($words as $w) {
				if (!str_contains($text, $w)) {
					continue 2;
				}
			}
			$out[] = ['name' => $tp['name'], 'local_name' => $local, 'field' => $t((string)($tp['cat'] ?? '')), 'expression' => $tp['expression'], 'variables' => $tp['variables'] ?? []];
			if (count($out) >= $limit) {
				break;
			}
		}
		return ['templates' => $out];
	}

	// ---- changing ----

	/** @param array<string, mixed> $in */
	private function apply(FormulaEntity $f, array $in): void {
		if (array_key_exists('expression', $in)) {
			try {
				$this->compiler->parse((string)$in['expression']);
			} catch (\Throwable $e) {
				throw new \InvalidArgumentException('The expression "' . mb_substr((string)$in['expression'], 0, 200) . '" does not parse: ' . $e->getMessage());
			}
			$f->setExpression((string)$in['expression']);
		}
		if (array_key_exists('name', $in)) {
			$f->setName(mb_substr(trim((string)$in['name']), 0, 255));
		}
		if (array_key_exists('description', $in)) {
			$f->setDescription(mb_substr((string)$in['description'], 0, 5000));
		}
		if (array_key_exists('variables', $in)) {
			$vars = [];
			foreach ((array)$in['variables'] as $v) {
				if (is_array($v) && trim((string)($v['key'] ?? '')) !== '') {
					$vars[] = array_intersect_key($v, array_flip(['key', 'label', 'unit', 'type', 'default']));
				}
			}
			$f->setVariables(json_encode($vars, JSON_UNESCAPED_UNICODE));
		}
		if (array_key_exists('result_unit', $in)) {
			$f->setResultUnit(mb_substr((string)$in['result_unit'], 0, 32));
		}
		if (array_key_exists('decimals', $in)) {
			$f->setDecimals(max(0, min(10, (int)$in['decimals'])));
		}
		if (array_key_exists('notes', $in)) {
			$f->setNotes((string)$in['notes']);
		}
	}

	private function insert(int $cid, array $in): FormulaEntity {
		$f = new FormulaEntity();
		$f->setCollectionId($cid);
		$f->setName('');
		$f->setExpression('');
		$f->setVariables('[]');
		$f->setDecimals(2);
		$this->apply($f, $in);
		if (trim((string)$f->getName()) === '' || trim((string)$f->getExpression()) === '') {
			throw new \InvalidArgumentException('A formula needs a name and an expression.');
		}
		$f->setSort($this->formulas->maxSort($cid) + 1);
		$f->setCreatedAt(self::now());
		$f->setUpdatedAt(self::now());
		return $this->formulas->insert($f);
	}

	private function createFormulas(string $uid, int $cid, array $list): array {
		$this->need($uid, $cid, 'edit');
		if (count($list) > 50) {
			throw new \InvalidArgumentException('At most 50 formulas at once.');
		}
		$made = [];
		$failed = [];
		foreach (array_values($list) as $i => $in) {
			try {
				$made[] = (int)$this->insert($cid, is_array($in) ? $in : [])->getId();
			} catch (\InvalidArgumentException $e) {
				$failed[] = ['number' => $i + 1, 'why' => $e->getMessage()];
			}
		}
		$names = array_map(fn ($in) => is_array($in) ? (string)($in['name'] ?? '') : '', array_values($list));
		$names = array_values(array_diff_key($names, array_flip(array_map(fn ($x) => $x['number'] - 1, $failed))));
		return ['created' => count($made), 'ids' => $made, 'failed' => $failed,
			'_report' => self::report($this->l($uid)->t('Add formulas'), $names, count($made)) . $this->failedPart($uid, $failed)];
	}

	private function addTemplates(string $uid, int $cid, array $names): array {
		$this->need($uid, $cid, 'edit');
		if (count($names) > 50) {
			throw new \InvalidArgumentException('At most 50 templates at once.');
		}
		$tr = $this->translator($uid);
		$dir = $this->templateDir();
		$manifest = json_decode((string)@file_get_contents($dir . '/manifest.json'), true) ?: [];
		$want = array_flip(array_map('strval', $names));
		$found = [];
		foreach ($manifest as $file) {
			if (!is_string($file) || !preg_match('/^cat_\d+\.json$/', $file)) {
				continue;
			}
			foreach (json_decode((string)@file_get_contents($dir . '/' . $file), true) ?: [] as $tp) {
				if (isset($want[$tp['name'] ?? '']) && !isset($found[$tp['name']])) {
					$found[$tp['name']] = $tp;
				}
			}
		}
		$made = [];
		$madeNames = [];
		foreach ($names as $n) {
			$tp = $found[(string)$n] ?? null;
			if ($tp === null) {
				continue;
			}
			$madeNames[] = $tr($tp['name']);
			$made[] = (int)$this->insert($cid, [
				'name' => $tr($tp['name']), 'expression' => (string)$tp['expression'], 'description' => $tr($tp['description'] ?? ''),
				'variables' => array_map(fn ($v) => array_merge($v, ['label' => $tr($v['label'] ?? ''), 'unit' => $tr($v['unit'] ?? '')]), (array)($tp['variables'] ?? [])),
				'result_unit' => $tr($tp['result_unit'] ?? ''), 'decimals' => $tp['decimals'] ?? 2, 'notes' => $tr($tp['notes'] ?? ''),
			])->getId();
		}
		$missing = array_values(array_diff(array_map('strval', $names), array_keys($found)));
		return ['added' => count($made), 'ids' => $made, 'not_found' => $missing,
			'_report' => self::report($this->l($uid)->t('Add templates'), $madeNames, count($made)) . $this->failedPart($uid, $missing)];
	}

	private function snapshot(FormulaEntity $f): array {
		return [
			'name' => $f->getName(), 'expression' => $f->getExpression(), 'description' => $f->getDescription(),
			'variables' => json_decode($f->getVariables() ?: '[]', true) ?: [], 'result_unit' => $f->getResultUnit(),
			'decimals' => $f->getDecimals(), 'notes' => $f->getNotes(),
		];
	}

	private function updateFormulas(string $uid, array $updates): array {
		if (count($updates) > 50) {
			throw new \InvalidArgumentException('At most 50 formulas at once.');
		}
		$done = [];
		$doneNames = [];
		$failed = [];
		foreach ($updates as $u) {
			$id = (int)($u['id'] ?? 0);
			try {
				$f = $this->formulas->find($id);
				$c = $this->need($uid, (int)$f->getCollectionId(), 'edit');
				// as it was, kept as a version whatever the owner set: what the assistant changed can be brought back
				$owner = (string)$c->getUserId();
				$this->versions->take($id, $this->snapshot($f), max(1, $this->versions->keep($owner)));
				$this->apply($f, array_diff_key((array)$u, ['id' => 1]));
				$f->setUpdatedAt(self::now());
				$this->formulas->update($f);
				$done[] = $id;
				$doneNames[] = (string)$f->getName();
			} catch (\Throwable $e) {
				$failed[] = ['id' => $id, 'why' => $e instanceof \InvalidArgumentException ? $e->getMessage() : ($e instanceof ForbiddenException ? 'no right to edit' : 'not found')];
			}
		}
		return ['updated' => count($done), 'ids' => $done, 'failed' => $failed,
			'_report' => self::report($this->l($uid)->t('Change formulas'), $doneNames) . $this->failedPart($uid, $failed)];
	}

	// ---- deleted by the assistant, and back ----

	private function deletedList(string $uid): array {
		$l = json_decode($this->config->getUserValue($uid, Application::APP_ID, self::DELETED_KEY, '[]'), true);
		return is_array($l) ? $l : [];
	}

	private function keepDeleted(string $uid, array $item): void {
		$l = $this->deletedList($uid);
		array_unshift($l, $item + ['at' => self::now()]);
		$this->config->setUserValue($uid, Application::APP_ID, self::DELETED_KEY, json_encode(array_slice($l, 0, self::DELETED_KEEP), JSON_UNESCAPED_UNICODE));
	}

	private function deleteFormulas(string $uid, array $ids): array {
		$done = [];
		$doneNames = [];
		$failed = [];
		foreach ($ids as $id) {
			try {
				$f = $this->formulas->find($id);
				$this->need($uid, (int)$f->getCollectionId(), 'delete');
				$this->keepDeleted($uid, ['kind' => 'formula', 'collection_id' => (int)$f->getCollectionId(), 'formula' => $this->snapshot($f)]);
				$this->history->deleteForFormula($id);
				$this->versions->drop($id);
				$this->formulas->delete($f);
				$done[] = $id;
				$doneNames[] = (string)$f->getName();
			} catch (\Throwable $e) {
				$failed[] = ['id' => $id, 'why' => $e instanceof ForbiddenException ? 'no right to delete' : 'not found'];
			}
		}
		return ['deleted' => count($done), 'ids' => $done, 'failed' => $failed,
			'_report' => self::report($this->l($uid)->t('Delete formulas'), $doneNames) . $this->failedPart($uid, $failed)];
	}

	private function createCollection(string $uid, array $a): array {
		$name = mb_substr(trim((string)$a['name']), 0, 255);
		if ($name === '') {
			throw new \InvalidArgumentException('A collection needs a name.');
		}
		$c = new CollectionEntity();
		$c->setUserId($uid);
		$c->setName($name);
		$c->setIcon(mb_substr(trim((string)($a['icon'] ?? '🧮')) ?: '🧮', 0, 16));
		$color = (string)($a['color'] ?? '#2563eb');
		$c->setColor(preg_match('/^#[0-9a-fA-F]{6}$/', $color) ? $color : '#2563eb');
		$c->setDescription(mb_substr((string)($a['description'] ?? ''), 0, 2000));
		$c->setSort($this->collections->maxSort($uid) + 1);
		$c->setCreatedAt(self::now());
		$c->setUpdatedAt(self::now());
		$c = $this->collections->insert($c);
		return ['created' => (int)$c->getId(), 'name' => $c->getName(), '_report' => self::report($this->l($uid)->t('Make a collection'), [$c->getName()])];
	}

	private function updateCollection(string $uid, array $a): array {
		$c = $this->need($uid, (int)$a['id'], 'delete');
		if (isset($a['name']) && trim((string)$a['name']) !== '') {
			$c->setName(mb_substr(trim((string)$a['name']), 0, 255));
		}
		if (isset($a['icon']) && trim((string)$a['icon']) !== '') {
			$c->setIcon(mb_substr(trim((string)$a['icon']), 0, 16));
		}
		if (isset($a['color']) && preg_match('/^#[0-9a-fA-F]{6}$/', (string)$a['color'])) {
			$c->setColor((string)$a['color']);
		}
		if (isset($a['description'])) {
			$c->setDescription(mb_substr((string)$a['description'], 0, 2000));
		}
		$c->setUpdatedAt(self::now());
		$this->collections->update($c);
		return ['updated' => (int)$c->getId(), '_report' => self::report($this->l($uid)->t('Change a collection'), [$c->getName()])];
	}

	private function deleteCollection(string $uid, int $id): array {
		$c = $this->collections->findForUser($id, $uid); // owner only
		$list = $this->formulas->findForCollection($id);
		$this->keepDeleted($uid, ['kind' => 'collection', 'collection' => ['name' => $c->getName(), 'icon' => $c->getIcon(), 'color' => $c->getColor(), 'description' => (string)$c->getDescription()],
			'formulas' => array_map(fn ($f) => $this->snapshot($f), $list)]);
		$this->shares->deleteForCollection($id);
		$this->history->deleteForCollection($id);
		$this->versions->dropMany(array_map(fn ($f) => (int)$f->getId(), $list));
		$this->formulas->deleteForCollection($id);
		$this->collections->delete($c);
		return ['deleted' => $id, 'formulas' => count($list),
			'_report' => self::report($this->l($uid)->t('Delete a collection'), [$c->getName()]) . ' (' . $this->l($uid)->t('Formulas') . ' ' . count($list) . ')'];
	}

	private function restoreDeleted(string $uid, array $numbers): array {
		$list = $this->deletedList($uid);
		if ($numbers === []) {
			$out = [];
			foreach ($list as $i => $it) {
				$out[] = ['number' => $i + 1, 'at' => $it['at'] ?? '', 'kind' => $it['kind'],
					'name' => $it['kind'] === 'collection' ? $it['collection']['name'] . ' (' . count($it['formulas']) . ' formulas)' : $it['formula']['name']];
			}
			return ['deleted_by_the_assistant' => $out, '_report' => $this->l($uid)->t('Looked at what the assistant deleted') . ' — ' . count($out)];
		}
		$back = [];
		$backNames = [];
		$gone = [];
		foreach ($numbers as $n) {
			$it = $list[$n - 1] ?? null;
			if ($it === null) {
				continue;
			}
			if ($it['kind'] === 'collection') {
				$c = $this->createCollection($uid, $it['collection']);
				foreach ($it['formulas'] as $snap) {
					$this->insert($c['created'], $snap);
				}
				$back[] = 'collection "' . $it['collection']['name'] . '" (id ' . $c['created'] . ')';
				$backNames[] = (string)$it['collection']['name'];
			} else {
				$cid = (int)$it['collection_id'];
				try {
					$this->need($uid, $cid, 'edit');
				} catch (\Throwable $e) {
					$gone[] = $it['formula']['name'] . ': its collection is gone or no longer editable; add it to another one with create_formulas';
					continue;
				}
				$f = $this->insert($cid, $it['formula']);
				$back[] = 'formula "' . $f->getName() . '" (id ' . $f->getId() . ')';
				$backNames[] = (string)$f->getName();
			}
			$list[$n - 1] = null;
		}
		$this->config->setUserValue($uid, Application::APP_ID, self::DELETED_KEY, json_encode(array_values(array_filter($list)), JSON_UNESCAPED_UNICODE));
		return ['restored' => $back, 'not_restored' => $gone,
			'_report' => self::report($this->l($uid)->t('Bring back what was deleted'), $backNames) . $this->failedPart($uid, $gone)];
	}
}
