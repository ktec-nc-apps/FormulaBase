<?php
/** @var array $_ */
/** @var \OCP\IL10N $l */
$tb = $_['hub'];
$s = $_['settings'];
$off = !$tb['present'];
$providers = ['claude' => 'Claude', 'gemini' => 'Gemini', 'openai' => 'OpenAI'];
$reasons = [
	'no-key' => $l->t('No API key is set in AI-Hub.'),
	'no-cli' => $l->t('AI-Hub\'s command line tool is not set up.'),
	'no-store' => $l->t('AI-Hub needs a memory cache or a writable temporary folder.'),
	'no-model' => $l->t('No model is chosen in AI-Hub.'),
];
?>
<div id="formulabase-ai-admin" class="section<?php if ($off) { p(' fb-off'); } ?>"
	data-saved="<?php p($l->t('Saved.')); ?>" data-failed="<?php p($l->t('Could not save.')); ?>">
	<h2><?php p($l->t('AI assistant')); ?></h2>
	<p class="settings-hint"><?php p($l->t('FormulaBase asks AI-Hub for its AI: a chat at the right of the screen that knows FormulaBase, explains and checks the open formulas, and reads only what is allowed here. It changes nothing. The key, the model and the limits are set in AI-Hub.')); ?></p>
	<?php if ($off) { ?>
		<p class="fb-ai-state warn"><?php p($l->t('AI-Hub is not installed or is switched off, so the assistant cannot be used. Install AI-Hub from the App Store to set it up here.')); ?></p>
	<?php } else { ?>
		<p class="fb-ai-state<?php if (!$tb['ready']) { p(' warn'); } ?>">
			<?php p($l->t('AI-Hub: %1$s (%2$s), model %3$s', [$providers[$tb['provider']] ?? $tb['provider'], $tb['mode'] === 'cli' ? $l->t('command line') : 'API', $tb['model'] !== '' ? $tb['model'] : '—'])); ?>
			— <?php p($tb['ready'] ? $l->t('Ready.') : ($reasons[$tb['reason']] ?? $tb['reason'])); ?>
		</p>
	<?php } ?>
	<fieldset <?php if ($off) { p('disabled'); } ?>>
		<p><input type="checkbox" class="checkbox" id="fb-ai-enabled" <?php if ($s['enabled']) { p('checked'); } ?>>
			<label for="fb-ai-enabled"><?php p($l->t('Use the AI assistant in FormulaBase')); ?></label></p>

		<h3><?php p($l->t('Who may use it')); ?></h3>
		<p><input type="radio" class="radio" name="fb-ai-users" id="fb-ai-users-all" value="all" <?php if ($s['users'] === 'all') { p('checked'); } ?>>
			<label for="fb-ai-users-all"><?php p($l->t('Everyone')); ?></label></p>
		<p><input type="radio" class="radio" name="fb-ai-users" id="fb-ai-users-groups" value="groups" <?php if ($s['users'] === 'groups') { p('checked'); } ?>>
			<label for="fb-ai-users-groups"><?php p($l->t('Only the members of these groups')); ?></label></p>
		<div class="fb-ai-groups">
			<?php foreach ($_['groups'] as $g) { $gid = 'fb-ai-g-' . md5($g['id']); ?>
				<p><input type="checkbox" class="checkbox" id="<?php p($gid); ?>" data-group="<?php p($g['id']); ?>" <?php if (in_array($g['id'], $s['groups'], true)) { p('checked'); } ?>>
					<label for="<?php p($gid); ?>"><?php p($g['name']); ?></label></p>
			<?php } ?>
		</div>

		<h3><?php p($l->t('What it may read (read only — it never changes anything there)')); ?></h3>
		<?php
		// The built-in templates are only named for now: there is no tool to read them yet.
		$sources = [
			'collection' => [$l->t('The open collection\'s formulas, with the values typed in'), true],
			'templates' => [$l->t('The built-in templates (not yet)'), false],
		];
		foreach ($sources as $src => [$label, $there]) { ?>
			<p><input type="checkbox" class="checkbox" id="fb-ai-read-<?php p($src); ?>" data-read="<?php p($src); ?>"
				<?php if (in_array($src, $s['read'], true)) { p('checked'); } ?> <?php if (!$there) { p('disabled'); } ?>>
				<label for="fb-ai-read-<?php p($src); ?>"><?php p($label); ?></label></p>
		<?php } ?>

		<h3><?php p($l->t('Web search')); ?></h3>
		<p><input type="checkbox" class="checkbox" id="fb-ai-search" <?php if ($s['search']) { p('checked'); } ?> <?php if (!$off && !$tb['search']) { p('disabled'); } ?>>
			<label for="fb-ai-search"><?php p($l->t('Let it search the web (on the AI provider\'s side: this server\'s own network is never reached)')); ?></label></p>
		<?php if (!$off && !$tb['search']) { ?>
			<p class="settings-hint"><?php p($l->t('Not available with the way AI-Hub connects to the AI.')); ?></p>
		<?php } ?>

		<p class="fb-ai-save"><button type="button" class="button primary" id="fb-ai-save"><?php p($l->t('Save')); ?></button>
			<span class="fb-ai-msg" aria-live="polite"></span></p>
	</fieldset>
</div>
