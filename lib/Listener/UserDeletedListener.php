<?php

declare(strict_types=1);

namespace OCA\FormulaBase\Listener;

use OCA\FormulaBase\Db\CollectionMapper;
use OCA\FormulaBase\Db\FormulaMapper;
use OCA\FormulaBase\Db\HistoryMapper;
use OCA\FormulaBase\Db\ShareMapper;
use OCA\FormulaBase\Service\FormulaVersionService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\UserDeletedEvent;

/**
 * When an account is deleted, its FormulaBase data goes with it: the collections it
 * owned (with their formulas, versions, history and shares), the shares it had
 * received, and the history it recorded in other people's collections. Nothing
 * listened for this before, so the rows stayed behind for good (REVIEW 2026-10-04 低9).
 *
 * @template-implements IEventListener<UserDeletedEvent>
 */
class UserDeletedListener implements IEventListener {
	public function __construct(
		private CollectionMapper $collections,
		private FormulaMapper $formulas,
		private HistoryMapper $history,
		private ShareMapper $shares,
		private FormulaVersionService $versions,
	) {
	}

	public function handle(Event $event): void {
		if (!($event instanceof UserDeletedEvent)) {
			return;
		}
		$uid = $event->getUser()->getUID();
		foreach ($this->collections->findAllForUser($uid) as $c) {
			$cid = (int)$c->getId();
			$this->shares->deleteForCollection($cid);
			$this->history->deleteForCollection($cid);
			$this->versions->dropMany(array_map(static fn ($f) => (int)$f->getId(), $this->formulas->findForCollection($cid)));
			$this->formulas->deleteForCollection($cid);
			$this->collections->delete($c);
		}
		$this->shares->deleteForRecipient($uid);
		$this->history->deleteForUser($uid);
	}
}
