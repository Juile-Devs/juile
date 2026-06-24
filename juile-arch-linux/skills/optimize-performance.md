# Optimize performance
1. Measure first: profile or time the slow path with `shell`/`python`. Find the real bottleneck.
2. Fix the biggest one (algorithm > micro-tuning). Re-measure to prove the win.
3. Report before/after numbers.
