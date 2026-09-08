import { PageHeader } from "@/components/couranr/shell/parts";
import { IncidentsWorkspace } from "@/components/couranr/operations/IncidentsWorkspace";

export const metadata={title:"Incidents and claims — Couranr"};

export default function Page(){
  return (
    <>
      <PageHeader
        title="Incidents and claims"
        breadcrumbs={[{label:"Operations",href:"/operations"},{label:"Incidents and claims"}]}
      />
      <IncidentsWorkspace/>
    </>
  );
}
