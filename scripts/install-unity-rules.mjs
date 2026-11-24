import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const bridge = fileURLToPath(new URL('../integrations/unity/', import.meta.url));
const project = process.argv[2];
if (!project) throw new Error('Usage: node scripts/install-unity-rules.mjs <Unity project>');
const assets = join(resolve(project), 'Assets');
const engine = join(assets, 'FootballSimulator', 'Code', 'MatchEngine');

// Only insert the integration hooks into the licensed asset. Keep a copy of each original.
const hooks = {
  'Players/Systems/TacklingSystem.cs': [
    ['if (ball.HolderPlayer.IsGK) {', 'if (ball.HolderPlayer == null || ball.HolderPlayer.IsGK) {\n                restoreTackler();'],
    ['                    if (isTacklingSuccess) {', '                    if (global::OpenFootMatchRules.TryTackle(this, ball.HolderPlayer, isTacklingSuccess)) {\n                        restoreTackler();\n                        return;\n                    }\n\n                    if (isTacklingSuccess) {'],
    ['            new TimerAction(TACKLING_RESPONSE_TIME).GetQuery()', '            var challengedPlayer = ball.HolderPlayer;\n            new TimerAction(TACKLING_RESPONSE_TIME).GetQuery()'],
    ['            void calculateTackling() {', '            void calculateTackling() {\n                if (challengedPlayer != ball.HolderPlayer && !challengedPlayer.IsGKUntouchable &&\n                    Vector3.Distance(challengedPlayer.Position, Position) < 1.6f &&\n                    global::OpenFootMatchRules.TryTackle(this, challengedPlayer, false, late: true)) {\n                    restoreTackler();\n                    return;\n                }'],
  ],
  'Ball/Ball.cs': [
    ['public void Hold(PlayerBase basePlayer) {', 'public void Hold(PlayerBase basePlayer) {\n            global::OpenFootMatchRules.BallHeld();'],
    ['            EventManager.Trigger(new PlayerShootEvent (hitter, velocity.magnitude));', '            global::OpenFootMatchRules.BallShot(hitter);\n            EventManager.Trigger(new PlayerShootEvent (hitter, velocity.magnitude));'],
    ['LastTouchedPlayer = collision.collider.gameObject.GetComponent<IPlayerController>().BasePlayer;', 'var touchingPlayer = collision.collider.gameObject.GetComponent<IPlayerController>().BasePlayer;\n                if (global::OpenFootMatchRules.TryOffside(touchingPlayer)) return;\n                LastTouchedPlayer = touchingPlayer;'],
  ],
  'Ball/BallActionDetector.cs': [
    ['EventManager.Trigger(new GoalEvent(!goal));', 'global::OpenFootMatchRules.BallCrossedGoalLine(!goal);\n                    EventManager.Trigger(new GoalEvent(!goal));'],
    ['case "OutAction":\n                    var index', 'case "OutAction":\n                    global::OpenFootMatchRules.BallOut();\n                    var index'],
    ['case "ThrowInAction":\n                    var fixedPos', 'case "ThrowInAction":\n                    global::OpenFootMatchRules.BallOut();\n                    var fixedPos'],
    ['                    global::OpenFootMatchRules.BallCrossedGoalLine(!goal);', '                    if (global::OpenFootMatchRules.BallCrossedGoalLine(!goal)) { Release(); return; }'],
    ['                    global::OpenFootMatchRules.BallOut();\n                    var index', '                    if (global::OpenFootMatchRules.BallOut()) { Release(); return; }\n                    var index'],
    ['                    global::OpenFootMatchRules.BallOut();\n                    var fixedPos', '                    if (global::OpenFootMatchRules.BallOut()) { Release(); return; }\n                    var fixedPos'],
  ],
  'GameTeam.cs': [
    ['for (int i=0; i < 11; i++) {', 'for (int i=0; i < GamePlayers.Length; i++) {'],
  ],
  'MatchPlayer.cs': [
    ['        #region GET FUNCTIONS with MODIFIERS, for in game match.', `        public void ApplyOpenFootCondition(float condition) {
            Setup();
            float physical = Mathf.Lerp(0.68f, 1f, condition);
            float technical = Mathf.Lerp(0.78f, 1f, condition);
            int Scale(int skill, float factor) => Mathf.RoundToInt(skill * factor);

            ActualAcceleration = Scale(ActualAcceleration, physical);
            ActualTopSpeed = Scale(ActualTopSpeed, physical);
            ActualAgility = Scale(ActualAgility, physical);
            ActualDribbleSpeed = Scale(ActualDribbleSpeed, physical);
            ActualStrength = Scale(ActualStrength, physical);
            ActualJump = Scale(ActualJump, physical);
            ActualShootPower = Scale(ActualShootPower, physical);
            ActualPassing = Scale(ActualPassing, technical);
            ActualLongBall = Scale(ActualLongBall, technical);
            ActualShooting = Scale(ActualShooting, technical);
            ActualTackling = Scale(ActualTackling, technical);
            ActualBallControl = Scale(ActualBallControl, technical);
            ActualBallKeeping = Scale(ActualBallKeeping, technical);
        }

        #region GET FUNCTIONS with MODIFIERS, for in game match.`],
    ['ModifySkill(Player.positioning, PlayerSkillCurves.Current.ReactionCurve)', 'ModifySkill(global::OpenFootMatchRules.ReactionSkill(Player), PlayerSkillCurves.Current.ReactionCurve)'],
    ['ActualShootPower = ModifySkill(Player.shooting,', 'ActualShootPower = ModifySkill(global::OpenFootMatchRules.ShotPowerSkill(Player),'],
  ],
  'Players/PlayerBase.cs': [
    ['Ball.Current.Pass(targetBallHitVector, this, targetBallHitSpeed, IsThrowHolder);', 'Ball.Current.Pass(targetBallHitVector, this, targetBallHitSpeed, IsThrowHolder || IsCornerHolder || IsGoalKickHolder);'],
    ['Ball.Current.Cross (targetBallHitVector, this, IsThrowHolder);', 'Ball.Current.Cross (targetBallHitVector, this, IsThrowHolder || IsCornerHolder || IsGoalKickHolder);'],
    ['            // Try chip shot if GK is away.', '            new global::OpenFootBreakawayBehaviour(),\n\n            // Try chip shot if GK is away.'],
  ],
  'Players/Behaviours/AbstractShootingBehaviour.cs': [
    ['            var goalToMe = Player.Position - targetGoalNet.Position;', '            var goalToMe = Player.Position - targetGoalNet.Position;\n            goalToMe.y = 0;\n            if (goalToMe.sqrMagnitude >= global::OpenFootShotSelection.MaximumShotDistance *\n                global::OpenFootShotSelection.MaximumShotDistance) return false;'],
  ],
  'Players/Behaviours/ShootingBehaviour.cs': [
    ['                var toGoal = targetGoalNet.Position - Player.Position;', '                var toGoal = targetGoalNet.Position - Player.Position;\n                toGoal.y = 0;\n                float distance = toGoal.magnitude;'],
    ['                float tolerance = adminMulti * (toleranceMod + (oneOnOne ? ONEONEONE_TOLERANCE_BONUS : 0));', '                float tolerance = adminMulti * (toleranceMod + (oneOnOne ? ONEONEONE_TOLERANCE_BONUS : 0))\n                    * global::OpenFootShotSelection.DistanceMultiplier(distance);'],
    ['                    toGoal.magnitude, ', '                    distance,'],
    ['var gkTol = keepingToleranceCurve.Evaluate(keeping / 100);', 'var gkTol = keepingToleranceCurve.Evaluate(\n                    global::OpenFootMatchRules.GoalkeepingSkill(opponentGK.MatchPlayer, keeping) / 100);'],
  ],
  'Players/Behaviours/ChipShootingBehaviour.cs': [
    ['            var lastOpponent = opponents.OrderBy(x => x.XPower(fieldEndX, x.Position)).FirstOrDefault();\n\n            var lastOpponentPosition = lastOpponent.Position;', '            var keeper = opponents.FirstOrDefault(x => x.IsGK && x.PlayerController.IsPhysicsEnabled);\n            if (keeper == null) return false;\n\n            var lastOpponentPosition = keeper.Position;\n            if (Mathf.Abs(lastOpponentPosition.x - goalNetPosition.x) <\n                global::OpenFootShotSelection.ChipKeeperAdvance) return false;'],
  ],
  'Players/Behaviours/KickOffBehaviour.cs': [
    ['            if (!isAlreadyActive) {', '            if (global::OpenFootMatchRules.TakePenalty(Player, deltaTime)) return true;\n\n            if (!isAlreadyActive) {'],
  ],
  'MatchManager.cs': [
    ['                onCameraTransition?.Invoke();\n\n', ''],
    ['                // reorder players.\n                void reOrderTeam(', '                onCameraTransition?.Invoke();\n\n                // reorder players.\n                void reOrderTeam('],
    ['bool matchShouldContinue = minutes < 90;', 'int periodEnd = global::OpenFootMatchRules.PeriodEnd;\n                bool matchShouldContinue = minutes < periodEnd;'],
    ['if (ballPosition.x > size && ballPosition.x < Current.fieldEndX - size) {', 'if (global::OpenFootMatchRules.ShouldFinish(this, ballPosition.x > size && ballPosition.x < Current.fieldEndX - size)) {'],
    ['minutes = Mathf.Min (90, minutes + deltaTime * matchSpeed);', 'minutes = Mathf.Min (periodEnd, minutes + deltaTime * matchSpeed);'],
  ],
};

const projectKey = createHash('sha256').update(resolve(project).toLowerCase()).digest('hex').slice(0, 16);
const backup = join(process.env.LOCALAPPDATA ?? homedir(), 'OpenFootUnityBackups', projectKey, 'FootballSimulator');
const edits = Object.entries(hooks).map(([file, replacements]) => {
  const source = join(engine, file);
  const original = join(backup, file);
  const contents = readFileSync(source, 'utf8');
  if (existsSync(original)) {
    const pristine = readFileSync(original, 'utf8');
    const expected = patch(pristine, replacements, file);
    const previousCount = { 'Players/Systems/TacklingSystem.cs': 2, 'MatchManager.cs': 2, 'Ball/BallActionDetector.cs': 3, 'Players/PlayerBase.cs': 2, 'MatchPlayer.cs': 1, 'Players/Behaviours/ShootingBehaviour.cs': 3 }[file];
    const previous = previousCount && patch(pristine, replacements.slice(0, previousCount), file);
    if (contents !== pristine && contents !== expected && contents !== previous) throw new Error(`Local changes in ${source}`);
    return { source, original, contents: pristine, patched: expected };
  }
  const hasExistingHooks = contents.includes('OpenFootMatchRules') ||
    contents.includes('global::OpenFootShotSelection.') ||
    (file === 'MatchPlayer.cs' && contents.includes('void ApplyOpenFootCondition(')) ||
    (file === 'GameTeam.cs' && contents.includes('i < GamePlayers.Length')) ||
    (file === 'Players/PlayerBase.cs' && contents.includes('IsThrowHolder || IsCornerHolder || IsGoalKickHolder')) ||
    (file === 'MatchManager.cs' && /onCameraTransition\?\.Invoke\(\);\r?\n\r?\n +\/\/ reorder players\./.test(contents));
  if (!hasExistingHooks) return { source, original, contents, patched: patch(contents, replacements, file) };

  const previousCount = {
    'Players/Systems/TacklingSystem.cs': ['var challengedPlayer', 2],
    'MatchManager.cs': ['OpenFootMatchRules.PeriodEnd', 2],
    'Ball/BallActionDetector.cs': ['if (global::OpenFootMatchRules.BallCrossedGoalLine', 3],
    'Players/PlayerBase.cs': ['new global::OpenFootBreakawayBehaviour()', 2],
    'MatchPlayer.cs': ['OpenFootMatchRules.ReactionSkill', 1],
    'Players/Behaviours/ShootingBehaviour.cs': ['OpenFootMatchRules.GoalkeepingSkill', 3],
  }[file];
  const installedHooks = previousCount && !contents.includes(previousCount[0])
    ? replacements.slice(0, previousCount[1]) : replacements;
  const reverse = [...installedHooks].reverse().map(([from, to]) => [to, from]);
  if (file === 'MatchManager.cs') {
    reverse[reverse.length - 1] = ['                if (foulType == FoulType.GoalKick) {\n                    SetOutColliders(false);',
      '                onCameraTransition?.Invoke();\n\n                if (foulType == FoulType.GoalKick) {\n                    SetOutColliders(false);'];
  }
  const pristine = patch(contents, reverse, file);
  return { source, original, contents: pristine, patched: patch(pristine, replacements, file) };
});

function patch(contents, replacements, file) {
  const crlf = contents.includes('\r\n');
  let result = contents.replaceAll('\r\n', '\n');
  for (const [before, after] of replacements) {
    if (result.split(before).length !== 2) throw new Error(`Expected one hook location in ${file}: ${before}`);
    result = result.replace(before, after);
  }
  return crlf ? result.replaceAll('\n', '\r\n') : result;
}

const destination = join(assets, 'OpenFootBridge');
for (const name of ['OpenFootMatchRules.cs', 'OpenFootMatchCondition.cs', 'OpenFootKnockout.cs', 'OpenFootShotSelection.cs']) {
  const adapter = join(bridge, name);
  const installedAdapter = join(destination, name);
  if (!existsSync(installedAdapter) || readFileSync(adapter, 'utf8') !== readFileSync(installedAdapter, 'utf8')) {
    copyFileSync(adapter, installedAdapter);
  }
}
for (const { source, original, contents, patched } of edits) {
  mkdirSync(join(original, '..'), { recursive: true });
  if (!existsSync(original)) writeFileSync(original, contents, { flag: 'wx' });
  if (readFileSync(source, 'utf8') !== patched) writeFileSync(source, patched);
}
