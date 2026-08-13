<?php

declare(strict_types=1);

return [
	'routes' => [
		['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],

		// collections
		['name' => 'api#collections', 'url' => '/api/collections', 'verb' => 'GET'],
		['name' => 'api#createCollection', 'url' => '/api/collections', 'verb' => 'POST'],
		['name' => 'api#updateCollection', 'url' => '/api/collections/{id}', 'verb' => 'PATCH'],
		['name' => 'api#deleteCollection', 'url' => '/api/collections/{id}', 'verb' => 'DELETE'],
		['name' => 'api#exportCollection', 'url' => '/api/collections/{id}/export', 'verb' => 'GET'],

		// export a single formula (calculation trace / calculable spreadsheet) into the user's Files
		['name' => 'api#browseFiles', 'url' => '/api/files/browse', 'verb' => 'GET'],
		['name' => 'api#exportFormulaMarkdown', 'url' => '/api/formulas/{id}/export/markdown', 'verb' => 'POST'],
		['name' => 'api#exportFormulaOds', 'url' => '/api/formulas/{id}/export/ods', 'verb' => 'POST'],

		// internal sharing (permission-only, no encryption)
		['name' => 'api#collectionShares', 'url' => '/api/collections/{id}/shares', 'verb' => 'GET'],
		['name' => 'api#addShare', 'url' => '/api/collections/{id}/shares', 'verb' => 'POST'],
		['name' => 'api#updateShare', 'url' => '/api/collections/{id}/shares/{uid}', 'verb' => 'PATCH'],
		['name' => 'api#removeShare', 'url' => '/api/collections/{id}/shares/{uid}', 'verb' => 'DELETE'],
		['name' => 'api#searchUsers', 'url' => '/api/users/search', 'verb' => 'GET'],

		// formulas
		['name' => 'api#formulas', 'url' => '/api/collections/{id}/formulas', 'verb' => 'GET'],
		['name' => 'api#createFormula', 'url' => '/api/collections/{id}/formulas', 'verb' => 'POST'],
		['name' => 'api#updateFormula', 'url' => '/api/formulas/{id}', 'verb' => 'PUT'],
		['name' => 'api#deleteFormula', 'url' => '/api/formulas/{id}', 'verb' => 'DELETE'],

		// calculation history (per user)
		['name' => 'api#history', 'url' => '/api/formulas/{id}/history', 'verb' => 'GET'],
		['name' => 'api#addHistory', 'url' => '/api/formulas/{id}/history', 'verb' => 'POST'],
		['name' => 'api#clearHistory', 'url' => '/api/formulas/{id}/history', 'verb' => 'DELETE'],
		['name' => 'api#deleteHistoryEntry', 'url' => '/api/history/{id}', 'verb' => 'DELETE'],

		// full backup / restore (all collections + formulas)
		['name' => 'api#backup', 'url' => '/api/backup', 'verb' => 'POST'],
		['name' => 'api#restore', 'url' => '/api/restore', 'verb' => 'POST'],

		// user settings (theme + language) and in-app language override
		['name' => 'api#getSettings', 'url' => '/api/settings', 'verb' => 'GET'],
		['name' => 'api#updateSettings', 'url' => '/api/settings', 'verb' => 'PUT'],
		['name' => 'api#getI18n', 'url' => '/api/i18n/{lang}', 'verb' => 'GET'],
		['name' => 'api#getEmoji', 'url' => '/api/emoji/{lang}', 'verb' => 'GET'],

		// formula templates (lazy-loaded: lightweight index + per-category bodies)
		['name' => 'api#templatesIndex', 'url' => '/api/templates/index', 'verb' => 'GET'],
		['name' => 'api#templatesCat', 'url' => '/api/templates/cat/{cat}', 'verb' => 'GET', 'requirements' => ['cat' => '.+']],
	],
];
