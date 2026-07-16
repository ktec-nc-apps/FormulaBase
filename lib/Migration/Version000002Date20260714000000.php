<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

class Version000002Date20260714000000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('formulabase_history')) {
			$t = $schema->createTable('formulabase_history');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('formula_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('collection_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('inputs', Types::TEXT, ['notnull' => true, 'default' => '{}']);
			$t->addColumn('label', Types::TEXT, ['notnull' => false]);
			$t->addColumn('result', Types::STRING, ['notnull' => true, 'length' => 64, 'default' => '']);
			$t->addColumn('unit', Types::STRING, ['notnull' => false, 'length' => 32]);
			$t->addColumn('created_at', Types::STRING, ['notnull' => true, 'length' => 32]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['user_id', 'formula_id'], 'fb_hist_user_formula');
			$t->addIndex(['collection_id'], 'fb_hist_coll');
		}

		return $schema;
	}
}
