import { doc, writeBatch } from "firebase/firestore";
import { getFirebaseClient } from "./firebase.js";
import { createSyncManager } from "./syncStatus.js";

export const cloudWrites = createSyncManager({
  async writeRemote(operations) {
    const client = await getFirebaseClient();
    if (!client) return false;
    const batch = writeBatch(client.db);
    for (const operation of operations) {
      const ref = doc(client.db, ...operation.path);
      if (operation.type === "delete") batch.delete(ref);
      else batch.set(ref, operation.data, { merge: true });
    }
    await batch.commit();
    return true;
  },
});
