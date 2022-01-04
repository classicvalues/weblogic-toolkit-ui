/**
 * @license
 * Copyright (c) 2021, Oracle and/or its affiliates.
 * Licensed under the Universal Permissive License v 1.0 as shown at https://oss.oracle.com/licenses/upl.
 */
const fsUtils = require('./fsUtils');
const { getLogger } = require('./wktLogging');
const { getHttpsProxyUrl, getBypassProxyHosts } = require('./userSettings');
const { executeChildProcess, executeFileCommand } = require('./childProcessExecutor');
const { getErrorMessage, getMaskedErrorMessage} = require('./errorUtils');
const osUtils = require('./osUtils');

/* global process */
async function validateImageBuilderExecutable(imageBuilderExe) {
  const i18n = require('./i18next.config');

  const result = { isValid: true };
  if (!imageBuilderExe || imageBuilderExe.length === 0) {
    result.isValid = false;
    result.reason = i18n.t('image-builder-not-specified');
    return Promise.resolve(false);
  }

  return new Promise(resolve => {
    fsUtils.exists(imageBuilderExe).then(imageBuilderExeExists => {
      result.isValid = imageBuilderExeExists;
      if (!imageBuilderExeExists) {
        result.reason = i18n.t('image-builder-not-exists', {imageBuilder: imageBuilderExe});
      }
      resolve(result);
    }).catch(err => {
      result.isValid = false;
      result.reason = i18n.t('image-builder-exists-error', {imageBuilder: imageBuilderExe, error: getErrorMessage(err) });
      resolve(result);
    });
  });
}

async function validateImageExistsLocally(imageBuilderExe, imageTag) {
  const args = [
    'images',
    '-q',
    imageTag
  ];
  const result = {
    isSuccess: true,
    imageExists: true
  };
  return new Promise(resolve => {
    executeFileCommand(imageBuilderExe, args).then(stdoutMessage => {
      if (!/\S/.test(stdoutMessage.toString())) {
        result.imageExists = false;
      }
      resolve(result);
    }).catch(err => {
      getLogger().error(err);
      result.isSuccess = false;
      result.imageExists = undefined;
      result.reason = getErrorMessage(err);
      resolve(result);
    });
  });
}

async function doLogin(imageBuilderExe, options) {
  const i18n = require('./i18next.config');
  const httpsProxyUrl = getHttpsProxyUrl();
  const bypassProxyHosts = getBypassProxyHosts();

  const result = { isSuccess: true };
  if (!options.requiresLogin) {
    return Promise.resolve({ isSuccess: true });
  }

  const env = getDockerEnv(httpsProxyUrl, bypassProxyHosts);
  const args = [
    'login'
  ];

  if (options.host) {
    args.push(options.host);
  } else {
    // podman does not always default to docker hub when logging in without a host.
    args.push('docker.io');
  }

  if (options.username) {
    args.push('-u', options.username);
  }
  if (options.password) {
    args.push('-p', options.password);
  }

  return new Promise(resolve => {
    executeFileCommand(imageBuilderExe, args, env, true).then(() => {
      resolve(result);
    }).catch(err => {
      const host = options.host ? options.host : i18n.t('tools-docker-hub');
      result.isSuccess = false;
      const message = i18n.t('image-builder-registry-login-failed',
        { imageRegistry: host, error: getMaskedErrorMessage(err, options.password) });
      result.reason = message;
      resolve(result);
    });
  });
}

async function doPushImage(currentWindow, stdoutChannel, stderrChannel, imageBuilderExe, imageTag, options) {
  const i18n = require('./i18next.config');
  const httpsProxyUrl = getHttpsProxyUrl();
  const bypassProxyHosts = getBypassProxyHosts();

  const result = { isSuccess: true };
  if (options.requiresLogin) {
    const loginResult = await doLogin(imageBuilderExe, options);
    if (!loginResult.isSuccess) {
      result.isSuccess = false;
      result.reason = loginResult.reason;
      return Promise.resolve(result);
    }
  }

  const args = [ 'push', imageTag ];
  const env = getDockerEnv(httpsProxyUrl, bypassProxyHosts);

  return new Promise(resolve => {
    executeChildProcess(currentWindow, imageBuilderExe, args, env, stdoutChannel,
      { stderrEventName: stderrChannel }).then(exitCode => {
      if (exitCode !== 0) {
        result.isSuccess = false;
        result.reason = i18n.t('image-builder-image-push-exit-code-error-message', { exitCode: exitCode });
      }
      resolve(result);
    }).catch(err => {
      result.isSuccess = false;
      result.reason = i18n.t('image-builder-image-push-failed',{ imageTag: imageTag, error: getErrorMessage(err) });
      resolve(result);
    });
  });
}

function getDockerEnv(httpsProxyUrl, bypassProxyHosts) {
  let env = {
    DOCKER_BUILDKIT: '0',
    // podman relies on the PATH including other executables (e.g., newuidmap)...
    PATH: process.env.PATH
  };

  // Docker-specific environment variables that should be passed on
  if (process.env.DOCKER_HOST) {
    env['DOCKER_HOST'] = process.env.DOCKER_HOST;
  }
  if (process.env.DOCKER_TLS_VERIFY) {
    env['DOCKER_TLS_VERIFY'] = process.env.DOCKER_TLS_VERIFY;
  }
  if (process.env.DOCKER_CERT_PATH) {
    env['DOCKER_CERT_PATH'] = process.env.DOCKER_CERT_PATH;
  }

  // podman-specific environment variables that should be passed on
  if(process.env.CONTAINER_HOST) {
    env['CONTAINER_HOST'] = process.env.CONTAINER_HOST;
  }
  if (process.env.STORAGE_DRIVER) {
    env['STORAGE_DRIVER'] = process.env.STORAGE_DRIVER;
  }
  if (process.env.STORAGE_OPTS) {
    env['STORAGE_OPTS'] = process.env.STORAGE_OPTS;
  }

  // proxy-related environment variables
  if (httpsProxyUrl) {
    env['HTTPS_PROXY'] = httpsProxyUrl;
    env['https_proxy'] = httpsProxyUrl;
  }
  if (bypassProxyHosts) {
    env['NO_PROXY'] = bypassProxyHosts;
    env['no_proxy'] = bypassProxyHosts;
  }

  if (!osUtils.isWindows()) {
    env['HOME'] = process.env.HOME;
  } else {
    env['USERPROFILE'] = process.env.USERPROFILE;
    env['PROGRAMDATA'] = process.env.PROGRAMDATA;
  }
  return env;
}

module.exports = {
  doLogin,
  doPushImage,
  getDockerEnv,
  validateImageBuilderExecutable,
  validateImageExistsLocally
};
