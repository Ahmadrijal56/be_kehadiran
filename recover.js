const fs = require('fs');
const readline = require('readline');
const transcriptPath = '/Users/dafapradipta/.gemini/antigravity-ide/brain/f478ed9e-f965-486e-81c4-2a55bb7be829/.system_generated/logs/transcript.jsonl';

async function recover() {
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    try {
      const step = JSON.parse(line);
      if (step.tool_calls) {
        for (const call of step.tool_calls) {
          if (call.function?.name === 'default_api:write_to_file') {
            let args;
            try { args = JSON.parse(call.function.arguments); } catch(e){}
            if (args && args.TargetFile) {
              console.log('Writing file:', args.TargetFile);
              if (!args.TargetFile.includes('.gemini')) {
                fs.mkdirSync(require('path').dirname(args.TargetFile), { recursive: true });
                fs.writeFileSync(args.TargetFile, args.CodeContent);
              }
            }
          }
        }
      }
    } catch (e) {
      // ignore parse errors
    }
  }
}
recover().then(() => console.log('Done'));
