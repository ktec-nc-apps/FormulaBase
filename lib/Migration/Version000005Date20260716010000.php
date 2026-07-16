<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Per-formula description (Markdown), shown between the title and the expression.
 */
class Version000005Date20260716010000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if ($schema->hasTable('formulabase_formulas')) {
			$t = $schema->getTable('formulabase_formulas');
			if (!$t->hasColumn('description')) {
				$t->addColumn('description', Types::TEXT, ['notnull' => false, 'default' => '']);
			}
		}

		return $schema;
	}
}
