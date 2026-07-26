#!/usr/bin/env bash

# Run one functionality test repeatedly against a single container, to smoke
# out flakes. On the first failure it prints the test's output and a dump of
# the discovery-related tables, then exits non-zero.
#
# Usage:
#   ./test/util/stress.sh ./functionality1/shadow-banned.sh 20

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
test_dir="$( readlink -m "$script_dir/.." )"

test_path="$( readlink -m "$test_dir/$1" )"
iterations=${2:-20}

source "$script_dir/setup.sh"

cd "$test_dir"

for i in $(seq "$iterations")
do
  echo "=== iteration $i/$iterations: $test_path"
  output=$( "$test_path" 2>&1 ) || {
    rc=$?
    echo "$output" | tail -120
    echo "STRESS FAILURE on iteration $i of $test_path"
    exit "$rc"
  }
done

echo "STRESS PASSED: $iterations/$iterations iterations of $test_path"
