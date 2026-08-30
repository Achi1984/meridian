MERIDIAN v6.91 DASHBOARD HOTFIX

Root cause of the blank screen:
A legacy patch block (v664-version-lock) contained a literal <style>...</style>
inside a normal JavaScript <script>. That is invalid JavaScript.

v6.91:
- moves that CSS back outside the script
- replaces the version lock with valid JavaScript
- removes the aggressive v6.90 runtime/cache stamping approach
- keeps Cloud Backtest endpoints and v6.89 Northflank backend unchanged
- does not change Engine 6.2.0, rules, Paperbot, or research calculations

Validation:
All normal inline JavaScript blocks were syntax-checked with Node before packaging.
