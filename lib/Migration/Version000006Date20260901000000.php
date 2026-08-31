<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Per-formula version history, kept the way EditBase keeps numbered version
 * files beside a document: #1 is always the most recent snapshot of a
 * formula's own fields, older ones shift down, and the oldest falls off once
 * past the user's keep-count.
 */
class Version000006Date20260901000000 extends SimpleMigrationStep {

	public function __construct(private IDBConnection $db) {
	}

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('formulabase_f_vers')) {
			$t = $schema->createTable('formulabase_f_vers');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true, 'length' => 20]);
			$t->addColumn('formula_id', Types::BIGINT, ['notnull' => true, 'length' => 20]);
			$t->addColumn('number', Types::INTEGER, ['notnull' => true, 'length' => 4]);
			// JSON snapshot of the formula's own fields: name, expression, description,
			// variables, result_unit, decimals, notes.
			$t->addColumn('data', Types::TEXT, ['notnull' => true, 'default' => '{}']);
			$t->addColumn('created_at', Types::STRING, ['notnull' => true, 'length' => 32]);
			$t->setPrimaryKey(['id']);
			$t->addUniqueIndex(['formula_id', 'number'], 'formulabase_ver_f_num');
		}

		return $schema;
	}
}
