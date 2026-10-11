# Standalone test for the runner's pure launch rules (launch_policy). Not part
# of the app build. CI:
#   cmake -S app/windows/runner/test -B build/runner_tests
#   cmake --build build/runner_tests --config Release
#   ctest --test-dir build/runner_tests -C Release --output-on-failure
cmake_minimum_required(VERSION 3.20)
project(mastersat_runner_tests LANGUAGES CXX)

add_executable(launch_policy_test launch_policy_test.cc ../launch_policy.cpp)
target_compile_features(launch_policy_test PRIVATE cxx_std_17)
target_include_directories(launch_policy_test PRIVATE ..)
if(MSVC)
  target_compile_options(launch_policy_test PRIVATE /W4 /WX /wd4100)
else()
  target_compile_options(launch_policy_test PRIVATE -Wall -Wextra -Werror)
endif()

enable_testing()
add_test(NAME launch_policy COMMAND launch_policy_test)
