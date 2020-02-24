#!/usr/bin/env node

const childProcess = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const program = require('commander');

const evmConfig = require('./evm-config');
const { color, fatal } = require('./utils/logging');
const { resolvePath, ensureDir } = require('./utils/paths');
const goma = require('./utils/goma');
const depot = require('./utils/depot-tools');
const { checkGlobalGitConfig } = require('./utils/git');
const { checkPlatformDependencies } = require('./utils/deps-check');

function createConfig(options) {
  const root = resolvePath(options.root);
  const homedir = os.homedir();

  // build the `gn gen` args
  const gn_args = [`import("//electron/build/args/${options.import}.gn")`];

  if (options.goma !== 'none') {
    gn_args.push(`import("${goma.gnFilePath}")`);
  }

  if (options.asan) gn_args.push('is_asan=true');
  if (options.lsan) gn_args.push('is_lsan=true');
  if (options.msan) gn_args.push('is_msan=true');
  if (options.tsan) gn_args.push('is_tsan=true');

  return {
    goma: options.goma,
    root,
    origin: {
      electron: options.useHttps
        ? 'https://github.com/electron/electron.git'
        : 'git@github.com:electron/electron.git',
      node: options.useHttps
        ? 'https://github.com/electron/node.git'
        : 'git@github.com:electron/node.git',
    },
    gen: {
      args: gn_args,
      out: options.out,
    },
    env: {
      CHROMIUM_BUILDTOOLS_PATH: path.resolve(root, 'src', 'buildtools'),
      GIT_CACHE_PATH: process.env.GIT_CACHE_PATH
        ? resolvePath(process.env.GIT_CACHE_PATH)
        : path.resolve(homedir, '.git_cache'),
    },
  };
}

function runGClientConfig(config) {
  const { root } = config;
  depot.ensure();
  const exec = 'python';
  const args = [
    'gclient.py',
    'config',
    '--name',
    'src/electron',
    '--unmanaged',
    'https://github.com/electron/electron',
  ];
  const opts = {
    cwd: root,
  };
  depot.execFileSync(config, exec, args, opts);
}

function ensureRoot(config) {
  const { root } = config;

  if (!fs.existsSync(root)) {
    ensureDir(root);
    runGClientConfig(config);
  } else if (fs.existsSync(path.resolve(root, '.gclient'))) {
    console.info(`${color.info} Root ${color.path(root)} already exists.`);
    console.info(`${color.info} (OK if you are sharing $root between multiple build configs)`);
  } else if (fs.readdirSync(root).length > 0) {
    throw Error(
      `Root ${color.path(root)} exists and is not empty. Please choose a different root directory.`,
    );
  }
}

let name;
let options;

program
  .arguments('<name>')
  .description('Create a new build configuration')
  .action((name_in, options_in) => {
    name = name_in;
    options = options_in;
  })
  .option(
    '-r, --root <path>',
    'Source and build files will be stored in this new directory',
    path.resolve(process.cwd(), 'electron'),
  )
  .option(
    '-i, --import <name>',
    'Import build settings from $root/src/electron/build/args/$import.gn',
    'testing',
  )
  .option('-o, --out <name>', 'Built files will be placed in $root/src/out/$out')
  .option('-f, --force', 'Overwrite existing build config with that name', false)
  .option('--asan', `When building, enable clang's address sanitizer`, false)
  .option('--tsan', `When building, enable clang's thread sanitizer`, false)
  .option('--msan', `When building, enable clang's memory sanitizer`, false)
  .option('--lsan', `When building, enable clang's leak sanitizer`, false)
  .option('--bootstrap', 'Run `e sync` and `e build` after creating the build config.')
  .option(
    '--goma <target>',
    `Use Electron's custom deployment of Goma.  Can be "cache-only", "cluster" or "none".  The "cluster" mode is only available to maintainers`,
    'cache-only',
  )
  .option(
    '--use-https',
    'During `e sync`, set remote origins with https://github... URLs instead of git@github...',
    false,
  )
  .parse(process.argv);

if (!name) {
  program.outputHelp();
  process.exit(1);
}

if (options.import && !options.out) {
  // e.g. the default out dir for a testing build is 'Testing'
  options.out = options.import.charAt(0).toUpperCase() + options.import.substring(1);
}

try {
  // Check global git settings that need to be enabled on Windows.
  if (os.platform() === 'win32') {
    checkGlobalGitConfig();
  }

  checkPlatformDependencies();

  // make sure the config name is new
  const filename = evmConfig.pathOf(name);
  if (!options.force && fs.existsSync(filename)) {
    throw Error(`Build config ${color.config(name)} already exists! (${color.path(filename)})`);
  }

  // Make sure the goma options are valid
  if (!['none', 'cache-only', 'cluster'].includes(options.goma)) {
    throw new Error(
      `Config property ${color.config('goma')} must be one of ${color.config(
        'cache-only',
      )} or ${color.config('cluster')} but you provided ${color.config(options.goma)}`,
    );
  }

  // save the new config
  const config = createConfig(options);
  ensureRoot(config);
  evmConfig.save(name, config);
  console.log(`New build config ${color.config(name)} created in ${color.path(filename)}`);

  // `e use` the new config
  const e = path.resolve(__dirname, 'e');
  const opts = { stdio: 'inherit' };
  childProcess.execFileSync('node', [e, 'use', name], opts);

  // (maybe) run sync to ensure external binaries are downloaded
  if (program.bootstrap) {
    childProcess.execFileSync('node', [e, 'sync', '-v', '--ignore_locks'], opts);
  }

  // maybe authenticate with Goma
  if (config.goma === 'cluster') {
    goma.auth();
  }

  // (maybe) build Electron
  if (program.bootstrap) {
    childProcess.execFileSync('node', [e, 'build'], opts);
  }
} catch (e) {
  fatal(e);
}
