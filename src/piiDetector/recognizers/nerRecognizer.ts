import { Recognizer, Entity } from "../../types";
import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";
// @ts-ignore
import its from "wink-nlp/src/its.js";

const nlp = winkNLP(model);

export const nerRecognizer: Recognizer = {
  id: "wink-ner",
  detect(text, map) {
    const doc = nlp.readDoc(text);
    return doc
      .entities()
      .out(its.detail)
      .filter((e: any) => e.type === "PERSON" || e.type === "LOCATION")
      .map((e: any) => ({
        type: e.type === "PERSON" ? "FULL_NAME" : "ADDRESS",
        start: map.origPos(e.start),
        end: map.origPos(e.end),
        text: text.slice(e.start, e.end),
        confidence: 0.7,
        source: this.id,
        risk: "sensitive" as const,
      })) as Entity[];
  },
};
