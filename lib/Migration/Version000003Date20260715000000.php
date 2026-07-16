<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

class Version000003Date20260715000000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('formulabase_colls')) {
			$t = $schema->getTable('formulabase_colls');
			if (!$t->hasColumn('description')) {
				$t->addColumn('description', Types::TEXT, ['notnull' => false, 'default' => '']);
			}
		}

		return $schema;
	}
}
