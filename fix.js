const fs = require("fs");
let code = fs.readFileSync("src/services/notificationService.ts", "utf8");
code = code.replace(/await createNotificationAndPush\(\{\n\s*data: \{/g, "await createNotificationAndPush({");
code = code.replace(/dataJson:\s*(.*?),\n\s*},\n\s*}\);/g, "dataJson: $1\n  });");
fs.writeFileSync("src/services/notificationService.ts", code);
