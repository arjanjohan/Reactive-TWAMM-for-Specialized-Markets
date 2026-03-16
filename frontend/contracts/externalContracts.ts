import { GenericContractsDeclaration } from "~~/utils/scaffold-eth/contract";
import ReactiveTWAMMAbi from "~~/contracts/abi/ReactiveTWAMM.json";
import TWAMMHookAbi from "~~/contracts/abi/TWAMMHook.json";

const externalContracts = {
  1301: {
    TWAMMHook: {
      address: "0x1eb187ec6240924c192230bfbbde6fdf13ce50c0",
      abi: TWAMMHookAbi,
    },
    ReactiveTWAMM: {
      address: "0x7087f17ecb3d5b90f83d561b27147c9fe67ee1e6",
      abi: ReactiveTWAMMAbi,
    },
  },
} as const;

export default externalContracts as GenericContractsDeclaration;
