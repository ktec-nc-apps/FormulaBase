<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Db;

use OCP\AppFramework\Db\Entity;

/**
 * @method int getCollectionId()
 * @method void setCollectionId(int $v)
 * @method string getName()
 * @method void setName(string $v)
 * @method string getExpression()
 * @method void setExpression(string $v)
 * @method ?string getDescription()
 * @method void setDescription(?string $v)
 * @method string getVariables()
 * @method void setVariables(string $v)
 * @method ?string getResultUnit()
 * @method void setResultUnit(?string $v)
 * @method int getDecimals()
 * @method void setDecimals(int $v)
 * @method ?string getNotes()
 * @method void setNotes(?string $v)
 * @method int getSort()
 * @method void setSort(int $v)
 * @method string getCreatedAt()
 * @method void setCreatedAt(string $v)
 * @method string getUpdatedAt()
 * @method void setUpdatedAt(string $v)
 */
class FormulaEntity extends Entity implements \JsonSerializable {
	protected $collectionId = 0;
	protected $name = '';
	protected $expression = '';
	protected $description = '';
	protected $variables = '[]';
	protected $resultUnit = '';
	protected $decimals = 2;
	protected $notes = '';
	protected $sort = 0;
	protected $createdAt = '';
	protected $updatedAt = '';

	public function __construct() {
		$this->addType('collectionId', 'integer');
		$this->addType('decimals', 'integer');
		$this->addType('sort', 'integer');
	}

	public function jsonSerialize(): array {
		$vars = json_decode($this->variables ?? '[]', true);
		if (!is_array($vars)) {
			$vars = [];
		}
		return [
			'id' => (int)$this->id,
			'collection_id' => (int)$this->collectionId,
			'name' => $this->name,
			'expression' => $this->expression,
			'description' => $this->description ?? '',
			'variables' => $vars,
			'result_unit' => $this->resultUnit ?? '',
			'decimals' => (int)$this->decimals,
			'notes' => $this->notes ?? '',
			'sort' => (int)$this->sort,
			'created_at' => $this->createdAt,
			'updated_at' => $this->updatedAt,
		];
	}
}
