const cp = require('child_process');

const { maybeAutoFix } = require('./maybe-auto-fix');
const { color } = require('./logging');

const spawnSyncWithLog = (cmd, args) => {
  console.log(color.childExec(cmd, args, {}));
  return cp.spawnSync(cmd, args);
};

function checkGlobalGitConfig() {
  const { stdout: fileMode } = cp.spawnSync('git', ['config', '--global', 'core.filemode']);

  if (fileMode.toString().trim() !== 'false') {
    maybeAutoFix(() => {
      spawnSyncWithLog('git', ['config', '--global', 'core.filemode', 'false']);
    }, new Error('git config --global core.filemode must be set to false.'));
  }

  const { stdout: autoCrlf } = cp.spawnSync('git', ['config', '--global', 'core.autocrlf']);
  if (autoCrlf.toString().trim() !== 'false') {
    maybeAutoFix(() => {
      spawnSyncWithLog('git', ['config', '--global', 'core.autocrlf', 'false']);
    }, new Error('git config --global core.autocrlf must be set to false.'));
  }

  const { stdout: autoSetupRebase } = cp.spawnSync('git', [
    'config',
    '--global',
    'branch.autosetuprebase',
  ]);
  if (autoSetupRebase.toString().trim() !== 'always') {
    maybeAutoFix(() => {
      spawnSyncWithLog('git', ['config', '--global', 'branch.autosetuprebase', 'always']);
    }, new Error('git config --global branch.autosetuprebase must be set to always.'));
  }
}

module.exports = {
  checkGlobalGitConfig,
};
