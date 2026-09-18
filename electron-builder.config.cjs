module.exports = {
  appId: 'local.phibee.desktop',
  productName: 'Phibee',
  directories: { output: 'release/installers' },
  artifactName: 'Phibee-${version}-${os}-${arch}.${ext}',
  publish: null,
  npmRebuild: false,
  files: [
    'dist/**/*',
    'desktop/**/*',
    'server/**/*',
    'package.json',
    'assets/**/*',
    'build/**/*',
    'b.png',
    'bee.png',
    '!release/**/*',
    '!landing/**/*',
    '!test-artifacts/**/*',
    '!tests/**/*',
    '!output/**/*',
    '!scripts/**/*'
  ],
  asarUnpack: [
    '**/node-pty/**'
  ],
  mac: {
    icon: 'assets/icon.icns'
  },
  win: {
    icon: 'assets/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }]
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico',
    installerHeaderIcon: 'assets/icon.ico',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
  },
  linux: {
    icon: 'build/icons',
    target: [{ target: 'AppImage', arch: ['x64'] }],
    category: 'Development',
    synopsis: 'A desktop workspace for your coding agents',
    executableName: 'phibee',
  },
};
