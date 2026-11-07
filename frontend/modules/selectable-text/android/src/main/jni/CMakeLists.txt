cmake_minimum_required(VERSION 3.13)

set(LIB_LITERAL SelectableTextSpec)
set(LIB_TARGET_NAME react_codegen_${LIB_LITERAL})
set(LIB_GENERATED_JNI_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../../build/generated/source/codegen/jni)
set(LIB_GENERATED_COMPONENTS_DIR ${LIB_GENERATED_JNI_DIR}/react/renderer/components/${LIB_LITERAL})

file(GLOB LIB_SRCS CONFIGURE_DEPENDS
  *.cpp
  ${LIB_GENERATED_JNI_DIR}/*.cpp
  ${LIB_GENERATED_COMPONENTS_DIR}/*.cpp)

add_library(${LIB_TARGET_NAME} SHARED ${LIB_SRCS})

target_include_directories(${LIB_TARGET_NAME} PUBLIC
  .
  ${LIB_GENERATED_JNI_DIR}
  ${LIB_GENERATED_COMPONENTS_DIR})

target_link_libraries(${LIB_TARGET_NAME} fbjni jsi reactnative)

target_compile_reactnative_options(${LIB_TARGET_NAME} PUBLIC)
