<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Internal collection sharing (no encryption / no share password):
 * one row per (collection, recipient) with a permission level.
 */
class Version000004Date20260716000000 extends SimpleMigrationStep {

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();

		if (!$schema->hasTable('formulabase_shares')) {
			$t = $schema->createTable('formulabase_shares');
			$t->addColumn('id', Types::BIGINT, ['autoincrement' => true, 'notnull' => true]);
			$t->addColumn('collection_id', Types::BIGINT, ['notnull' => true]);
			$t->addColumn('owner_uid', Types::STRING, ['notnull' => true, 'length' => 64]);
			$t->addColumn('recipient_uid', Types::STRING, ['notnull' => true, 'length' => 64]);
			// permission level: 'view' | 'edit' | 'delete'
			$t->addColumn('perm', Types::STRING, ['notnull' => true, 'length' => 8, 'default' => 'view']);
			$t->addColumn('created_at', Types::STRING, ['notnull' => true, 'length' => 32]);
			$t->setPrimaryKey(['id']);
			$t->addIndex(['collection_id'], 'fb_share_coll');
			$t->addIndex(['recipient_uid'], 'fb_share_rcpt');
			$t->addUniqueIndex(['collection_id', 'recipient_uid'], 'fb_share_uniq');
		}

		return $schema;
	}
}
