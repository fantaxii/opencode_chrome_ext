module.exports = {
  hooks: {
    'after:bump': 'echo "Version bumped!"',
    'after:release': 'echo "Successfully released ${version}!"'
  },
  git: {
    commitMessage: 'release: v${version}',
    requireCleanWorkingDir: false,
    tagName: 'v${version}',
    tagAnnotation: 'Release v${version}'
  },
  github: {
    release: true,
    releaseName: 'OpenCode Chrome Extension v${version}',
    autoGenerate: true
  },
  npm: {
    publish: false
  }
};