# Deep research report — collect many sources, synthesise a cited report

Use this when the user asks for thorough research on a topic.

1. Break the topic into 6–12 sharp subquestions (angles: definition, how it works,
   latest 2026 developments, key players, data/statistics, criticism/risks,
   comparisons/alternatives, real-world examples).
2. Call `deep_research` with those subqueries and `max_per_query` 8–10.
3. Read the returned source bundle. If a critical angle is thin, call `deep_research`
   again with refined subqueries.
4. Write a structured final answer with: an executive summary, sectioned findings,
   a `table` widget of key facts/figures, and a numbered **Sources** list using the
   [n] markers from the bundle. Add a `chart` widget if the data supports one.
5. State clearly how many unique sources informed the report.
