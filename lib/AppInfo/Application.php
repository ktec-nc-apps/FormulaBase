<?php

declare(strict_types=1);

namespace OCA\FormulaBase\AppInfo;

use OCA\FormulaBase\Listener\UserDeletedListener;
use OCA\FormulaBase\Service\AiService;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\User\Events\UserDeletedEvent;

class Application extends App implements IBootstrap {
	public const APP_ID = 'formulabase';

	/**
	 * Language codes FormulaBase once shipped under, and the Nextcloud code each now means.
	 * Nextcloud uses a translation for the language set in a user's account only when the
	 * file has that exact name, and it has pt_BR/pt_PT and zh_CN/zh_TW/zh_HK, never a bare
	 * pt or zh. l10n/zh.* is still shipped beside zh_CN for the browser-language fallback
	 * (an account in zh_TW or zh_HK gets Chinese rather than English), but is not offered
	 * in the language picker; a stored "pt" or "zh" is read as the code it now means.
	 */
	public const OLD_LANGUAGES = ['pt' => 'pt_PT', 'zh' => 'zh_CN'];

	public function __construct() {
		parent::__construct(self::APP_ID);
	}

	public function register(IRegistrationContext $context): void {
		// a deleted account takes its collections, shares and history with it
		$context->registerEventListener(UserDeletedEvent::class, UserDeletedListener::class);
	}

	public function boot(IBootContext $context): void {
		// AI-Hub, when it is installed, is told what FormulaBase's assistant is -- in
		// every request, since the hub keeps scenarios in memory only and the
		// request that works out an answer is not the one that asked.
		if (class_exists('\\OCA\\AIHub\\Service\\HubService')) {
			$context->injectFn(static function (AiService $ai): void {
				$ai->registerScenario();
			});
		}
	}
}
