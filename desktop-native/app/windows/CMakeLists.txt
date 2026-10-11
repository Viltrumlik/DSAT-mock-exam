# Project-level configuration.
cmake_minimum_required(VERSION 3.14)
project(mastersat_app LANGUAGES CXX)

# The name of the executable created for the application. Change this to change
# the on-disk name of your application.
set(BINARY_NAME "MasterSAT")

# Explicitly opt in to modern CMake behaviors to avoid warnings with recent
# versions of CMake.
cmake_policy(VERSION 3.14...3.25)

# Define build configuration option.
get_property(IS_MULTICONFIG GLOBAL PROPERTY GENERATOR_IS_MULTI_CONFIG)
if(IS_MULTICONFIG)
  set(CMAKE_CONFIGURATION_TYPES "Debug;Profile;Release"
    CACHE STRING "" FORCE)
else()
  if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE "Debug" CACHE
      STRING "Flutter build mode" FORCE)
    set_property(CACHE CMAKE_BUILD_TYPE PROPERTY STRINGS
      "Debug" "Profile" "Release")
  endif()
endif()
# Define settings for the Profile build mode.
set(CMAKE_EXE_LINKER_FLAGS_PROFILE "${CMAKE_EXE_LINKER_FLAGS_RELEASE}")
set(CMAKE_SHARED_LINKER_FLAGS_PROFILE "${CMAKE_SHARED_LINKER_FLAGS_RELEASE}")
set(CMAKE_C_FLAGS_PROFILE "${CMAKE_C_FLAGS_RELEASE}")
set(CMAKE_CXX_FLAGS_PROFILE "${CMAKE_CXX_FLAGS_RELEASE}")

# Use Unicode for all projects.
add_definitions(-DUNICODE -D_UNICODE)

# Compilation settings that should be applied to most targets.
#
# Be cautious about adding new options here, as plugins use this function by
# default. In most cases, you should add new options to specific targets instead
# of modifying this function.
function(APPLY_STANDARD_SETTINGS TARGET)
  target_compile_features(${TARGET} PUBLIC cxx_std_17)
  target_compile_options(${TARGET} PRIVATE /W4 /WX /wd"4100")
  target_compile_options(${TARGET} PRIVATE /EHsc)
  target_compile_definitions(${TARGET} PRIVATE "_HAS_EXCEPTIONS=0")
  target_compile_definitions(${TARGET} PRIVATE "$<$<CONFIG:Debug>:_DEBUG>")
endfunction()

# Flutter library and tool build rules.
set(FLUTTER_MANAGED_DIR "${CMAKE_CURRENT_SOURCE_DIR}/flutter")
add_subdirectory(${FLUTTER_MANAGED_DIR})

# Application build; see runner/CMakeLists.txt.
add_subdirectory("runner")


# Generated plugin build rules, which manage building the plugins and adding
# them to the application.
include(flutter/generated_plugins.cmake)


# === MasterSAT: native library + island pages (windows-host) ===
# desktop-native/ (this file is desktop-native/app/windows/CMakeLists.txt).
get_filename_component(MS_DESKTOP_NATIVE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)

# mastersat_native.dll (Rust cdylib, desktop-native/native).
#   MS_LINK_NATIVE     AUTO (default) | ON | OFF   (CMake cache option)
#   MS_NATIVE_LIB_DIR  folder holding mastersat_native.dll + .dll.lib
# AUTO links the DLL when it has been built and builds without it otherwise,
# so the app still builds before the Rust crate exists. `flutter build
# windows` cannot pass -D options, so the environment variables of the same
# names override the cache (CI sets MS_LINK_NATIVE=ON once the crate builds).
set(MS_LINK_NATIVE "AUTO" CACHE STRING "Link mastersat_native.dll: AUTO, ON or OFF")
set_property(CACHE MS_LINK_NATIVE PROPERTY STRINGS AUTO ON OFF)
if(DEFINED ENV{MS_LINK_NATIVE})
  set(MS_LINK_NATIVE "$ENV{MS_LINK_NATIVE}" CACHE STRING "Link mastersat_native.dll: AUTO, ON or OFF" FORCE)
endif()
if(NOT MS_LINK_NATIVE MATCHES "^(AUTO|ON|OFF)$")
  message(FATAL_ERROR "MS_LINK_NATIVE must be AUTO, ON or OFF (got '${MS_LINK_NATIVE}')")
endif()
set(MS_NATIVE_LIB "")
if(NOT MS_LINK_NATIVE STREQUAL "OFF")
  # Environment paths arrive with backslashes; CMake needs forward slashes
  # (a backslash in install() code is an escape sequence).
  file(TO_CMAKE_PATH "$ENV{MS_NATIVE_LIB_DIR}" _ms_native_env_dir)
  set(_ms_native_candidates
    "${_ms_native_env_dir}"
    "${MS_DESKTOP_NATIVE_DIR}/native/target/x86_64-pc-windows-msvc/release"
    "${MS_DESKTOP_NATIVE_DIR}/native/target/release")
  foreach(_dir IN LISTS _ms_native_candidates)
    if(_dir AND EXISTS "${_dir}/mastersat_native.dll.lib" AND EXISTS "${_dir}/mastersat_native.dll")
      set(MS_NATIVE_LIB "${_dir}/mastersat_native.dll.lib")
      set(MS_NATIVE_DLL "${_dir}/mastersat_native.dll")
      break()
    endif()
  endforeach()
  if(NOT MS_NATIVE_LIB AND MS_LINK_NATIVE STREQUAL "ON")
    message(FATAL_ERROR "MS_LINK_NATIVE=ON but mastersat_native.dll(.lib) was not found "
                        "(set MS_NATIVE_LIB_DIR or build desktop-native/native first)")
  endif()
endif()
if(MS_NATIVE_LIB)
  message(STATUS "MasterSAT: linking ${MS_NATIVE_LIB}")
  target_compile_definitions(${BINARY_NAME} PRIVATE MS_HAVE_NATIVE)
  target_include_directories(${BINARY_NAME} PRIVATE "${MS_DESKTOP_NATIVE_DIR}/native/include")
  target_link_libraries(${BINARY_NAME} PRIVATE "${MS_NATIVE_LIB}")
else()
  message(STATUS "MasterSAT: building WITHOUT mastersat_native.dll (no Velopack hooks, no lockdown)")
endif()


# === Installation ===
# Support files are copied into place next to the executable, so that it can
# run in place. This is done instead of making a separate bundle (as on Linux)
# so that building and running from within Visual Studio will work.
set(BUILD_BUNDLE_DIR "$<TARGET_FILE_DIR:${BINARY_NAME}>")
# Make the "install" step default, as it's required to run.
set(CMAKE_VS_INCLUDE_INSTALL_TO_DEFAULT_BUILD 1)
if(CMAKE_INSTALL_PREFIX_INITIALIZED_TO_DEFAULT)
  set(CMAKE_INSTALL_PREFIX "${BUILD_BUNDLE_DIR}" CACHE PATH "..." FORCE)
endif()

set(INSTALL_BUNDLE_DATA_DIR "${CMAKE_INSTALL_PREFIX}/data")
set(INSTALL_BUNDLE_LIB_DIR "${CMAKE_INSTALL_PREFIX}")

install(TARGETS ${BINARY_NAME} RUNTIME DESTINATION "${CMAKE_INSTALL_PREFIX}"
  COMPONENT Runtime)

install(FILES "${FLUTTER_ICU_DATA_FILE}" DESTINATION "${INSTALL_BUNDLE_DATA_DIR}"
  COMPONENT Runtime)

install(FILES "${FLUTTER_LIBRARY}" DESTINATION "${INSTALL_BUNDLE_LIB_DIR}"
  COMPONENT Runtime)

if(PLUGIN_BUNDLED_LIBRARIES)
  install(FILES "${PLUGIN_BUNDLED_LIBRARIES}"
    DESTINATION "${INSTALL_BUNDLE_LIB_DIR}"
    COMPONENT Runtime)
endif()

# MasterSAT: the Rust DLL sits next to the exe (the runner links it; Dart's
# DynamicLibrary.open returns the same loaded module).
if(MS_NATIVE_LIB)
  install(FILES "${MS_NATIVE_DLL}" DESTINATION "${INSTALL_BUNDLE_LIB_DIR}"
    COMPONENT Runtime)
endif()

# MasterSAT: the island pages (desktop-native/island, `npm run build`) go to
# data/island next to the exe; ms_webview2 maps https://island.mastersat.example/
# to that folder. Environment:
#   MS_ISLAND_DIR  the island build (default desktop-native/island/build/island)
#   MS_S0_PROBE=1  when there is no island build, install the S0 probe page
#                  (desktop-native/packaging/s0-probe) instead: CI diagnostics
#                  only, never a release.
set(MS_ISLAND_DIR "${MS_DESKTOP_NATIVE_DIR}/island/build/island")
if(DEFINED ENV{MS_ISLAND_DIR})
  file(TO_CMAKE_PATH "$ENV{MS_ISLAND_DIR}" MS_ISLAND_DIR)
endif()
set(INSTALL_BUNDLE_ISLAND_DIR "${INSTALL_BUNDLE_DATA_DIR}/island")
install(CODE "
  file(REMOVE_RECURSE \"${INSTALL_BUNDLE_ISLAND_DIR}\")
  " COMPONENT Runtime)
if(EXISTS "${MS_ISLAND_DIR}/content.html")
  message(STATUS "MasterSAT: installing the island build from ${MS_ISLAND_DIR}")
  install(DIRECTORY "${MS_ISLAND_DIR}/" DESTINATION "${INSTALL_BUNDLE_ISLAND_DIR}"
    COMPONENT Runtime)
elseif("$ENV{MS_S0_PROBE}" STREQUAL "1")
  message(WARNING "MasterSAT: no island build at ${MS_ISLAND_DIR}; installing the S0 probe page")
  install(DIRECTORY "${MS_DESKTOP_NATIVE_DIR}/packaging/s0-probe/"
    DESTINATION "${INSTALL_BUNDLE_ISLAND_DIR}" COMPONENT Runtime)
else()
  message(WARNING "MasterSAT: no island build at ${MS_ISLAND_DIR} "
                  "(run `npm ci && npm run build` in desktop-native/island); "
                  "questions will not render")
endif()

# Copy the native assets provided by the build.dart from all packages.
set(NATIVE_ASSETS_DIR "${PROJECT_BUILD_DIR}native_assets/windows/")
install(DIRECTORY "${NATIVE_ASSETS_DIR}"
   DESTINATION "${INSTALL_BUNDLE_LIB_DIR}"
   COMPONENT Runtime)

# Fully re-copy the assets directory on each build to avoid having stale files
# from a previous install.
set(FLUTTER_ASSET_DIR_NAME "flutter_assets")
install(CODE "
  file(REMOVE_RECURSE \"${INSTALL_BUNDLE_DATA_DIR}/${FLUTTER_ASSET_DIR_NAME}\")
  " COMPONENT Runtime)
install(DIRECTORY "${PROJECT_BUILD_DIR}/${FLUTTER_ASSET_DIR_NAME}"
  DESTINATION "${INSTALL_BUNDLE_DATA_DIR}" COMPONENT Runtime)

# Install the AOT library on non-Debug builds only.
install(FILES "${AOT_LIBRARY}" DESTINATION "${INSTALL_BUNDLE_DATA_DIR}"
  CONFIGURATIONS Profile;Release
  COMPONENT Runtime)
