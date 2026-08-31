<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Db;

use OCP\AppFramework\Db\QBMapper;
use OCP\DB\QueryBuilder\IQueryBuilder;
use OCP\IDBConnection;

/**
 * @extends QBMapper<FormulaVersionEntity>
 */
class FormulaVersionMapper extends QBMapper {
	public function __construct(IDBConnection $db) {
		parent::__construct($db, 'formulabase_f_vers', FormulaVersionEntity::class);
	}

	public function findByFormulaAndNumber(int $formulaId, int $number): ?FormulaVersionEntity {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('formula_id', $qb->createNamedParameter($formulaId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->eq('number', $qb->createNamedParameter($number, IQueryBuilder::PARAM_INT)));
		$rows = $this->findEntities($qb);
		return $rows[0] ?? null;
	}

	/** @return FormulaVersionEntity[] a formula's versions, newest (lowest number) first */
	public function listForFormula(int $formulaId): array {
		$qb = $this->db->getQueryBuilder();
		$qb->select('*')->from($this->getTableName())
			->where($qb->expr()->eq('formula_id', $qb->createNamedParameter($formulaId, IQueryBuilder::PARAM_INT)))
			->orderBy('number', 'ASC');
		return $this->findEntities($qb);
	}

	/** Delete every version of a formula numbered $fromNumber or higher (the ones past the keep limit). */
	public function deleteFromNumber(int $formulaId, int $fromNumber): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('formula_id', $qb->createNamedParameter($formulaId, IQueryBuilder::PARAM_INT)))
			->andWhere($qb->expr()->gte('number', $qb->createNamedParameter($fromNumber, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	public function deleteAllForFormula(int $formulaId): void {
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->eq('formula_id', $qb->createNamedParameter($formulaId, IQueryBuilder::PARAM_INT)));
		$qb->executeStatement();
	}

	/** All formula ids of one collection that have any version rows (used to bulk-drop on collection delete). */
	public function deleteAllForFormulas(array $formulaIds): void {
		if (!$formulaIds) {
			return;
		}
		$qb = $this->db->getQueryBuilder();
		$qb->delete($this->getTableName())
			->where($qb->expr()->in('formula_id', $qb->createNamedParameter(array_map('intval', $formulaIds), IQueryBuilder::PARAM_INT_ARRAY)));
		$qb->executeStatement();
	}
}
