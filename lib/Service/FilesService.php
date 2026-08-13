<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Service;

use OCP\Files\Folder;
use OCP\Files\IRootFolder;
use OCP\Files\NotPermittedException;

/**
 * Writes exported formulas (Markdown / ODS) into the user's own Files area.
 * Mirrors RegiBase's ImageService browse/save pattern so the two apps behave
 * the same way when picking a destination folder.
 */
class FilesService {
	public function __construct(
		private IRootFolder $rootFolder,
	) {
	}

	/** Keep a single-segment-safe name (no slashes / traversal / reserved). */
	private function sanitizeName(string $name): string {
		$name = str_replace(['/', '\\', "\0"], '-', $name);
		$name = trim($name, " \t.");
		if ($name === '' || $name === '.' || $name === '..') {
			return 'folder';
		}
		return mb_substr($name, 0, 120);
	}

	/** Allow a multi-segment relative path (e.g. "Documents/Formulas"). */
	private function sanitizePath(string $path): string {
		$parts = array_filter(
			array_map([$this, 'sanitizeName'], explode('/', str_replace('\\', '/', $path))),
			fn ($p) => $p !== ''
		);
		return implode('/', $parts);
	}

	private function ensureFolder(Folder $parent, string $name): Folder {
		$name = $this->sanitizeName($name);
		if ($parent->nodeExists($name)) {
			$node = $parent->get($name);
			if ($node instanceof Folder) {
				return $node;
			}
			$name .= '-folder';
			if ($parent->nodeExists($name) && $parent->get($name) instanceof Folder) {
				return $parent->get($name);
			}
		}
		return $parent->newFolder($name);
	}

	/** Ensure a multi-segment Files-relative folder exists (creating it if needed); returns it. */
	private function ensurePath(string $userId, string $folderPath): Folder {
		$dir = $this->rootFolder->getUserFolder($userId);
		$path = $this->sanitizePath($folderPath);
		foreach (explode('/', $path) as $seg) {
			if ($seg !== '') {
				$dir = $this->ensureFolder($dir, $seg);
			}
		}
		return $dir;
	}

	/**
	 * List the contents of a Files folder for the app's own folder picker.
	 * Returns folders first, then files, sorted naturally by name.
	 * @return array|null  null when the path is not a readable folder
	 */
	public function browse(string $userId, string $path): ?array {
		try {
			$userFolder = $this->rootFolder->getUserFolder($userId);
			$rel = trim($path, '/');
			$node = $rel === '' ? $userFolder : $userFolder->get($rel);
		} catch (\Throwable $e) {
			return null;
		}
		if (!($node instanceof Folder)) {
			return null;
		}
		$entries = [];
		foreach ($node->getDirectoryListing() as $child) {
			$isDir = $child instanceof Folder;
			$childRel = ltrim((string)($userFolder->getRelativePath($child->getPath()) ?? ''), '/');
			$entries[] = [
				'name' => $child->getName(),
				'path' => $childRel,
				'is_dir' => $isDir,
			];
		}
		usort($entries, static function (array $a, array $b): int {
			if ($a['is_dir'] !== $b['is_dir']) {
				return $a['is_dir'] ? -1 : 1;
			}
			return strnatcasecmp($a['name'], $b['name']);
		});
		$parent = null;
		if ($rel !== '') {
			$p = dirname($rel);
			$parent = ($p === '.' || $p === '/') ? '' : $p;
		}
		return ['path' => $rel, 'parent' => $parent, 'entries' => $entries];
	}

	/**
	 * Save raw bytes as a new file under the given Files-relative folder (creating the
	 * folder chain if needed). Auto-numbers the name on collision, like the Files app does.
	 * @return array{id: int, name: string, path: string}
	 * @throws \RuntimeException on invalid input or a write failure
	 */
	public function saveFile(string $userId, string $folderPath, string $filename, string $content): array {
		$filename = $this->sanitizeName($filename);
		if ($filename === '' || $filename === 'folder') {
			throw new \RuntimeException('Invalid file name');
		}
		try {
			$dir = $this->ensurePath($userId, $folderPath);
			$ext = '';
			$stem = $filename;
			if (($dot = strrpos($filename, '.')) !== false && $dot > 0) {
				$ext = substr($filename, $dot + 1);
				$stem = substr($filename, 0, $dot);
			}
			$fname = $filename;
			$n = 2;
			while ($dir->nodeExists($fname)) {
				$fname = $ext !== '' ? ($stem . ' (' . $n++ . ').' . $ext) : ($filename . ' (' . $n++ . ')');
			}
			$file = $dir->newFile($fname, $content);
			$userFolder = $this->rootFolder->getUserFolder($userId);
			$rel = ltrim((string)($userFolder->getRelativePath($file->getPath()) ?? ''), '/');
			return ['id' => $file->getId(), 'name' => $fname, 'path' => $rel];
		} catch (NotPermittedException $e) {
			throw new \RuntimeException('Cannot write to the destination folder');
		}
	}
}
