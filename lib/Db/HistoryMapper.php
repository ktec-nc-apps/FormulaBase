<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @extends QBMapper<HistoryEntity>
 */
class HistoryMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'formulabase_history', HistoryEntity::class);
	}

	/** @return HistoryEntity[] */
	public function findForFormula(string $userId, int $formulaId, int $limit = 50): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('formula_id', $qb->createNamedParameter($formulaId, IQueryBuilder::PARAM_INT)))
			->orderBy('id', 'DESC')
			->setMaxResults($limit);
		return $this->findEntities($qb);
	}

	public function find(int $id): HistoryEntity {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('id', $qb->createNamedParameter($id, IQueryBuilder::PARAM_INT)));
		return $this->findEntity($qb);
	}

	public function clearForFormula(string $userId, int $formulaId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('formula_id', $qb->createNamedParameter($formulaId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	public function deleteForCollection(int $collectionId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('collection_id', $qb->createNamedParameter($collectionId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	/** Keep only the newest $keep rows for a formula/user. */
	public function trim(string $userId, int $formulaId, int $keep = 50): void {
		$qb = $this->db->getQueryBuilder();
		$qb->select('id')->from($this->getTableName())
			->where($qb->expr()->eq('user_id', $qb->createNamedParameter($userId)))
			->andWhere($qb->expr()->eq('formula_id', $qb->createNamedParameter($formulaId, IQueryBuilder::PARAM_INT)))
			->orderBy('id', 'DESC')
			->setFirstResult($keep)->setMaxResults(1000);
		$r = $qb->executeQuery();
		$ids = array_map(static fn ($row) => (int)$row['id'], $r->fetchAll());
		$r->closeCursor();
		if (!$ids) {
			return;
		}
		$del = $this->db->getQueryBuilder();
		$del->delete($this->getTableName())
			->where($del->expr()->in('id', $del->createNamedParameter($ids, IQueryBuilder::PARAM_INT_ARRAY)));
		$del->executeStatement();
	}
}
