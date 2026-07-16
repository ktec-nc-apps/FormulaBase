<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @extends QBMapper<FormulaEntity>
 */
class FormulaMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'formulabase_formulas', FormulaEntity::class);
	}

	/** @return FormulaEntity[] */
	public function findForCollection(int $collectionId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('collection_id', $qb->createNamedParameter($collectionId, IQueryBuilder::PARAM_INT)))
			->orderBy('sort', 'ASC')->addOrderBy('id', 'ASC');
		return $this->findEntities($qb);
	}

	public function find(int $id): FormulaEntity {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		return $this->findEntity($qb);
	}

	public function maxSort(int $collectionId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->select($qb->func()->max('sort'))->from($this->getTableName())
			->where($qb->expr()->eq('collection_id', $qb->createNamedParameter($collectionId, IQueryBuilder::PARAM_INT)));
		$r = $qb->executeQuery();
		$v = (int)$r->fetchOne();
		$r->closeCursor();
		return $v;
	}

	public function deleteForCollection(int $collectionId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('collection_id', $qb->createNamedParameter($collectionId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}
}
