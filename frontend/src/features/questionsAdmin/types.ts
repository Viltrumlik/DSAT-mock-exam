/** Admin question row from GET …/modules/:moduleId/questions/ */
export type AdminModuleQuestion = {
  id: number;
  module_id?: number;
  order: number;
  question_text: string;
  question_type: string;
  score?: number;
  is_active?: boolean;
};
