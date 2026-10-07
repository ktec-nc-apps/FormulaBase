<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Settings;

use OCP\IL10N;
use OCP\IURLGenerator;
use OCP\Settings\IIconSection;

/** "FormulaBase" in the administration settings, for its AI assistant. */
class AiSection implements IIconSection {
	public function __construct(
		private IL10N $l,
		private IURLGenerator $url,
	) {
	}

	public function getID(): string {
		return 'formulabase';
	}

	public function getName(): string {
		return $this->l->t('FormulaBase');
	}

	public function getPriority(): int {
		return 80;
	}

	public function getIcon(): string {
		return $this->url->imagePath('formulabase', 'app-dark.svg');
	}
}
