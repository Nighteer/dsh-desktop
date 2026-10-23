import {rename as nativeRename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

// Windows scanners can briefly hold newly rendered files. Retry the same atomic
// operation; never fall back to deleting a destination or copying over it.
export async function rename(source, destination, {operation=nativeRename, wait=delay, platform=process.platform}={}) {
  for (let attempt=0;;attempt++) {
    try { return await operation(source, destination); }
    catch (error) {
      if (platform!=='win32' || !['EPERM','EACCES','EBUSY'].includes(error.code) || attempt>=5) throw error;
      await wait(50 * 2 ** attempt);
    }
  }
}
