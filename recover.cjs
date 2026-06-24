const fs = require('fs');
const readline = require('readline');
const path = require('path');
const transcriptPath = '/Users/dafapradipta/.gemini/antigravity-ide/brain/f478ed9e-f965-486e-81c4-2a55bb7be829/.system_generated/logs/transcript.jsonl';

async function recover() {
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  
  const filesToRecover = new Map();

  for await (const line of rl) {
    try {
      const step = JSON.parse(line);
      if (step.tool_calls) {
        for (const call of step.tool_calls) {
          const args = call.args || (call.function && call.function.arguments ? JSON.parse(call.function.arguments) : null);
          if (!args) continue;

          // Process write_to_file
          if (call.name === 'write_to_file' || call.name === 'default_api:write_to_file') {
            if (args.TargetFile && args.CodeContent && !args.TargetFile.includes('.gemini')) {
              filesToRecover.set(args.TargetFile, args.CodeContent);
              console.log('Found write_to_file for', args.TargetFile);
            }
          }
          
          // Process replace_file_content / multi_replace_file_content
          if (call.name === 'replace_file_content' || call.name === 'default_api:replace_file_content' || call.name === 'multi_replace_file_content' || call.name === 'default_api:multi_replace_file_content') {
             if (args.TargetFile && !args.TargetFile.includes('.gemini')) {
               // The exact replacement is hard without the original file state, but for NEW files that were edited, 
               // we can just reconstruct them if they were fully written. 
               // For multi_replace, we can't easily auto-apply them without the file context.
               console.log('Found replace for', args.TargetFile);
             }
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // Write all fully recovered files
  for (const [targetPath, content] of filesToRecover.entries()) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content);
    console.log('Successfully recovered:', targetPath);
  }
}

recover().then(() => console.log('Recovery complete.'));
