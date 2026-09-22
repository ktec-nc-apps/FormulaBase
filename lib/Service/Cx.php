<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Service;

/** A complex number. */
class Cx {
	public function __construct(public float $re, public float $im) {
	}
}
