const fs = require('fs');
let code = fs.readFileSync('lss.txt', 'utf8');
code = code.replace('    lookLong  := false\n    setupBarS := bar_index', '    log("245")\n    lookLong  := false\n    setupBarS := bar_index');
code = code.replace('if not inSession\n    lookLong  := false', 'if not inSession\n    log("254")\n    lookLong  := false');
code = code.replace('if lookLong  and (bar_index - setupBarL) > expireBars\n    lookLong  := false', 'if lookLong  and (bar_index - setupBarL) > expireBars\n    log("258")\n    lookLong  := false');
fs.writeFileSync('lss_debug.txt', code);
