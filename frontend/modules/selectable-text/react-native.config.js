module.exports = {
  dependency: {
    platforms: {
      android: {
        componentDescriptors: ['SelectableTextComponentDescriptor'],
        cmakeListsPath: 'src/main/jni/CMakeLists.txt',
      },
      ios: null,
    },
  },
};
