import { SurveyFillPage } from "@/features/surveys/SurveyFillPage";

export default async function Page({ params }: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await params;
  return <SurveyFillPage surveyId={Number(surveyId)} />;
}
