<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

class Version000001Date20260713000000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('formulabase_colls')) {
			$t = $schema->createTable('formulabase_colls');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('user_id', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
			$t->addColumn('icon', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => '🧮']);
			$t->addColumn('color', Types::STRING, ['notnull' => true, 'length' => 16, 'default' => '#2563eb']);
			$t->addColumn('sort', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			$t->addColumn('created_at', Types::STRING, ['notnull' => true, 'length' => 32]);
			$t->addColumn('updated_at', Types::STRING, ['notnull' => true, 'length' => 32]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['user_id'], 'fb_coll_user');
		}

		if (!$schema->hasTable('formulabase_formulas')) {
			$t = $schema->createTable('formulabase_formulas');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('collection_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('name', Types::STRING, ['notnull' => true, 'length' => 255]);
			$t->addColumn('expression', Types::TEXT, ['notnull' => true, 'default' => '']);
			$t->addColumn('variables', Types::TEXT, ['notnull' => true, 'default' => '[]']);
			$t->addColumn('result_unit', Types::STRING, ['notnull' => false, 'length' => 32]);
			$t->addColumn('decimals', Types::INTEGER, ['notnull' => true, 'default' => 2]);
			$t->addColumn('notes', Types::TEXT, ['notnull' => false]);
			$t->addColumn('sort', Types::INTEGER, ['notnull' => true, 'default' => 0]);
			$t->addColumn('created_at', Types::STRING, ['notnull' => true, 'length' => 32]);
			$t->addColumn('updated_at', Types::STRING, ['notnull' => true, 'length' => 32]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['collection_id'], 'fb_formula_coll');
		}

		return $schema;
	}
}
