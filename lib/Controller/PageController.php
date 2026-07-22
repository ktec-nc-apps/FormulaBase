<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Controller;

use OCA\FormulaBase\AppInfo\Application;
use OCP\App\IAppManager;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;
use OCP\Util;

class PageController extends Controller {
	public function __construct(
		IRequest $request,
		private IAppManager $appManager,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function index(): TemplateResponse {
		Util::addStyle(Application::APP_ID, 'formulabase');
		// Runtime-only Vue + precompiled render function (no template compiler → no eval).
		Util::addScript(Application::APP_ID, 'vue.runtime.global.prod');
		Util::addScript(Application::APP_ID, 'vue-private');
		Util::addScript(Application::APP_ID, 'formulabase.dist');

		return new TemplateResponse(Application::APP_ID, 'main', [
			'version' => $this->appManager->getAppVersion(Application::APP_ID),
			'loading' => 'Loading…',
		]);
	}
}
