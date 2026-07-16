<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method string getUserId()
 * @method void setUserId(string $v)
 * @method int getFormulaId()
 * @method void setFormulaId(int $v)
 * @method int getCollectionId()
 * @method void setCollectionId(int $v)
 * @method string getInputs()
 * @method void setInputs(string $v)
 * @method string getLabel()
 * @method void setLabel(string $v)
 * @method string getResult()
 * @method void setResult(string $v)
 * @method ?string getUnit()
 * @method void setUnit(?string $v)
 * @method string getCreatedAt()
 * @method void setCreatedAt(string $v)
 */
class HistoryEntity extends Entity implements \JsonSerializable {
	protected $userId = '';
	protected $formulaId = 0;
	protected $collectionId = 0;
	protected $inputs = '{}';
	protected $label = '';
	protected $result = '';
	protected $unit = '';
	protected $createdAt = '';

	public function __construct() {
		$this->addType('formulaId', 'integer');
		$this->addType('collectionId', 'integer');
	}

	public function jsonSerialize(): array {
		$in = json_decode($this->inputs ?? '{}', true);
		if (!is_array($in)) {
			$in = [];
		}
		return [
			'id' => (int)$this->id,
			'formula_id' => (int)$this->formulaId,
			'collection_id' => (int)$this->collectionId,
			'inputs' => $in,
			'label' => $this->label,
			'result' => $this->result,
			'unit' => $this->unit ?? '',
			'created_at' => $this->createdAt,
		];
	}
}
