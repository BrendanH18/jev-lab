"""Lab pack lint-structure: one test per question check on ids, paths, the state and pictures, and a check that no
rule reports on any built-in request."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from labkit import pack_tests  # noqa: E402
from lablint_corpus import assert_quiet  # noqa: E402
from jev.lab.packs import lint_structure  # noqa: E402

REF, REF2 = "photo-3fa9c1d2e7a1", "photo-0b1c2d3e4f5a"
STATE = {"message": "My order arrived late.", "order": {"id": "A-1041", "items": [{"name": "Grinder"}, {"name": "Kettle"}]},
         "customer_note": "Please hurry."}
PHOTO = {"context": "A delivered order", "photo": REF}


def noul(text):
    return {"type": "noul", "instructions": text, "criteria": {"true": "A clear case", "false": "No sign of it"}}


def box(text):
    return {"type": "box", "instructions": text}


def ask(text, state=STATE, qid="x", refs=()):
    return (state, {qid: noul(text)}, list(refs))


CASES = {
    "id_not_snake_case": {"hit": (STATE, {"isUrgent": noul("Is `message` urgent?")}), "miss": (STATE, {"is_urgent": noul("Is `message` urgent?")}),
                          "question": "isUrgent", "message": "such as `is_urgent`"},
    "uninformative_id": {"hit": (STATE, {"noul_2": noul("Is `message` urgent?")}), "miss": (STATE, {"q0.where": noul("Is `message` urgent?")}),
                         "question": "noul_2", "message": "^`noul_2` is a numbered id"},
    "ids_differ_by_case": {"hit": (STATE, {"is_urgent": noul("Is `message` urgent?"), "IsUrgent": noul("Is `message` pressing?")}),
                           "miss": (STATE, {"is_urgent": noul("Is `message` urgent?"), "is_upset": noul("Is `message` upset?")}),
                           "question": "is_urgent", "message": "`is_urgent` and `IsUrgent`"},
    "id_collides_with_csv": {"hit": (STATE, {"Label:urgent": noul("Is `message` urgent?")}), "miss": (STATE, {"row_count": noul("Is `message` urgent?")}),
                             "question": "Label:urgent", "message": "^Question id `Label:urgent` collides"},
    "id_unusable_in_rules": {"hit": (STATE, {"is urgent": noul("Is `message` urgent?")}), "miss": (STATE, {"urgent,today!": noul("Is `message` urgent?")}),
                             "question": "is urgent", "message": "cannot be named in a rule"},
    "id_same_as_state_field": {"hit": (STATE, {"message": noul("Is `message` urgent?")}), "miss": (STATE, {"urgent": noul("Is `message` urgent?")}),
                               "question": "message", "message": "^Question `message` has the same name as a state field"},
    "array_path_without_index": {"hit": ask("Is `order.items.name` a grinder?"), "miss": ask("Is `order.items[0].name` a grinder?"),
                                 "question": "x", "message": "`order.items`, which is a list.*`order.items\\[0\\].name`"},
    "path_case_mismatch": {"hit": ask("Is `Message` urgent?"), "miss": ask("Is `message` urgent?"), "question": "x",
                           "message": "but `message` is"},
    "path_plural": {"hit": ask("Is `order.item[0].name` a grinder?"), "miss": ask("Is `order.items[0].name` a grinder?"), "question": "x",
                    "message": "but `order.items\\[0\\].name` is"},
    "path_typo": {"hit": ask("Is `mesage` urgent?"), "miss": ask("Is `messages` urgent?"), "question": "x", "message": "did you mean `message`\\?"},
    "path_index_off_by_one": {"hit": ask("Is `order.items[2].name` a grinder?"), "miss": ask("Is `order.items[5].name` a grinder?"),
                              "question": "x", "message": "`order.items` has 2 items, numbered from 0, so the last one is `order.items\\[1\\]`"},
    "path_too_deep": {"hit": ask("Is `message.text` urgent?"), "miss": ask("Is `message` urgent?"), "question": "x",
                      "message": "steps into `message`, which is a single value"},
    "path_missing_parent": {"hit": ask("Is `id` a wholesale order?"), "miss": ask("Is `name` a grinder?"), "question": "x",
                            "message": "`id` is not a top-level field, but `order.id` is"},
    "path_syntax": {"hit": ask('Is `order["id"]` a wholesale order?'), "miss": ask("Compare with `datetime(year, month, day)`. Is `message` urgent?"),
                    "question": "x", "message": "Write it as `order.id`"},
    "refers_to_question": {"hit": (STATE, {"x": noul("If `is_urgent` is yes, does `message` ask for a refund?"), "is_urgent": noul("Is `message` urgent?")}),
                           "miss": (STATE, {"x": noul("If `customer_note` says so, does `message` ask for a refund?"), "is_urgent": noul("Is `message` urgent?")}),
                           "question": "x", "message": "names the question `is_urgent`"},
    "path_to_empty_value": {"hit": ask("Does `note` mention a refund?", dict(STATE, note="  ")), "miss": ask("Does `note` mention a refund?", dict(STATE, note="Refund")),
                            "question": "x", "message": "^`note` is empty"},
    "link_as_data": {"hit": ask("Does `link` point at a refund form?", dict(STATE, link="https://harbor.example/r/1")),
                     "miss": ask("Does `message` point at a refund form?", dict(STATE, link="https://harbor.example/r/1")),
                     "question": "x", "message": "^`link` holds only a link"},
    "no_field_named": {"hit": ask("Is it urgent?"), "miss": ask("Is `message` urgent?"), "question": "x", "message": "has 3 fields"},
    "unticked_field": {"hit": ask("Does customer_note mention a refund?"), "miss": ask("Does `customer_note` mention a refund?"),
                       "question": "x", "message": "mentions `customer_note` as a plain word"},
    "unaddressable_field": {"hit": ask("Is `message` urgent?", {"message": "Late", "order id": "A-1041"}), "miss": ask("Is `message` urgent?"),
                            "question": None, "message": "`order id` cannot.*such as `order_id`"},
    "state_keys_differ_by_case": {"hit": ask("Is `message` urgent?", {"message": "Late", "Message": "Late"}), "miss": ask("Is `message` urgent?"),
                                  "question": None, "message": "`message` and `Message` in the top of the state"},
    "deep_state": {"hit": ask("Is `message` urgent?", {"message": "Late", "a": {"b": {"c": {"d": {"e": {"f": {"g": "x"}}}}}}}),
                   "miss": ask("Is `message` urgent?", {"message": "Late", "a": {"b": {"c": {"d": {"e": {"f": "x"}}}}}}),
                   "question": None, "message": "nests 7 levels deep"},
    "large_state": {"hit": ask("Is `message` urgent?", {"message": "x" * 20000}), "miss": ask("Is `message` urgent?", {"message": "x" * 19985}),
                    "question": None, "message": "is 20015 characters"},
    "large_unreferenced_field": {"hit": ask("Is `message` urgent?", {"message": "Late", "history": "y" * 3000}),
                                 "miss": ask("Does `history` show that `message` repeats a complaint?", {"message": "Late", "history": "y" * 3000}),
                                 "question": None, "message": "^`history` holds 3002 of the state's 3034 characters"},
    "empty_state_values": {"hit": ask("Is `message` urgent?", {"message": "Late", "note": None, "tags": []}), "miss": ask("Is `message` urgent?"),
                           "question": None, "message": "^2 fields of the state are empty or null \\(`note`, `tags`\\)"},
    "row_marks_in_state": {"hit": ask("Is `message` urgent?", dict(STATE, _expect={"x": "yes"})), "miss": ask("Is `message` urgent?"),
                           "question": None, "message": "`_expect`, a Bulk row mark"},
    "answer_in_state": {"hit": ask("Is `message` urgent?", dict(STATE, label="urgent")), "miss": ask("Is `message` urgent?", dict(STATE, labels_printed=2)),
                        "question": None, "message": "field `label`"},
    "json_string_state": {"hit": ask("Is `message` urgent?", {"message": '{"text": "late", "order": "A-1"}'}),
                          "miss": ask("Is `message` urgent?", {"message": "{late} order"}), "question": None, "message": "^`message` is JSON"},
    "markup_in_state": {"hit": ask("Is `message` urgent?", {"message": "<p>My order arrived late.</p>"}),
                        "miss": ask("Is `message` urgent?", {"message": "My order <3 arrived late"}), "question": None, "message": "^`message` holds HTML"},
    "blob_in_state": {"hit": ask("Is `message` urgent?", dict(STATE, attachment="data:image/png;base64,iVBORw0KGgo=")),
                      "miss": ask("Is `message` urgent?"), "question": None, "message": "^`attachment` holds encoded data"},
    "quoted_state_text": {"hit": ask("Is “The espresso machine arrived completely shattered yesterday afternoon.” a damage claim?",
                                     {"message": "The espresso machine arrived completely shattered yesterday afternoon."}),
                          "miss": ask("Does `message` describe damage?", {"message": "The espresso machine arrived completely shattered yesterday afternoon."}),
                          "question": "x", "message": "also in `message`"},
    "state_picture_not_carried": {"hit": ask("Is the bag in `photo` torn?", PHOTO), "miss": ask("Is the bag in `photo` torn?", PHOTO, refs=[REF]),
                                  "question": None, "message": "^`photo` holds what looks like a picture reference"},
    "box_without_picture": {"hit": (PHOTO, {"spill": box("the spilled beans in `photo`")}), "miss": (PHOTO, {"spill": box("the spilled beans in `photo`")}, [REF]),
                            "question": "spill", "message": "carries none"},
    "box_names_no_picture": {"hit": ({"before": REF, "after": REF2}, {"tear": box("the torn seam")}, [REF, REF2]),
                             "miss": ({"before": REF, "after": REF2}, {"tear": box("the torn seam in `after`")}, [REF, REF2]),
                             "question": "tear", "message": "carries 2 pictures"},
    "box_many_targets": {"hit": (PHOTO, {"spill": box("all the spilled beans in `photo`")}, [REF]),
                         "miss": (PHOTO, {"spill": box("the largest pile of spilled beans in `photo`")}, [REF]), "question": "spill", "message": '"all"'},
    "box_is_question": {"hit": (PHOTO, {"tear": box("Where is the tear in `photo`?")}, [REF]), "miss": (PHOTO, {"tear": box("the tear in `photo`")}, [REF]),
                        "question": "tear", "message": "not a question"},
    "box_without_noul": {"hit": (PHOTO, {"tear": box("the tear in `photo`")}, [REF]),
                         "miss": (PHOTO, {"tear": box("the tear in `photo`"), "torn": noul("Is the bag in `photo` torn?")}, [REF]),
                         "question": "tear", "message": "Add a Noul"},
    "picture_word_no_picture": {"hit": ask("Is the bag in the photo torn?"),
                                "miss": ask("Does `message` say the customer sent a photo?"), "question": "x", "message": "about a photo"},
    "picture_repeated": {"hit": ask("Is the bag in `photo` torn?", {"photo": REF, "again": REF}, refs=[REF]),
                         "miss": ask("Is the bag in `photo` torn?", {"photo": REF}, refs=[REF]), "question": None,
                         "message": "^Picture `photo-3fa9c1d2e7a1` appears 2 times"},
    "picture_unused": {"hit": ask("Is `context` about an order?", PHOTO, refs=[REF]), "miss": ask("Is the bag in `photo` torn?", PHOTO, refs=[REF]),
                       "question": None, "message": "^Picture `photo-3fa9c1d2e7a1` is in the request, but no question points at it"},
}


BUILD_REF = "photo-1a2b3c4d5e"  # Build's own references: photo- and ten hex digits

# Requests each rule must leave alone.
QUIET = [
    ("uninformative_id", (STATE, {"is_test_order": noul("Is `message` urgent?")})),
    ("id_collides_with_csv", (STATE, {"_expected_total": noul("Is `message` urgent?")})),
    ("state_picture_not_carried", ({"order": "order-1234567890", "photo": "photo-torn-bag"}, {"x": noul("Is `order` late?")})),
    ("box_many_targets", (PHOTO, {"spill": box("the largest of all the spilled piles in `photo`")}, [REF])),
    ("picture_word_no_picture", (PHOTO, {"x": noul("Is the bag in the photo torn?")}, [REF])),
]

# More forms each rule must catch, with what its message should say.
HITS = [
    ("uninformative_id", (STATE, {"test": noul("Is `message` urgent?")}), "^`test` is a placeholder id"),
    ("uninformative_id", (STATE, {"Q12": noul("Is `message` urgent?")}), "^`Q12` is a numbered id"),
    ("id_collides_with_csv", (STATE, {"row": noul("Is `message` urgent?")}), "`row` holds the row"),
    ("id_unusable_in_rules", (STATE, {"total>=10": noul("Is `message` urgent?")}), "`total>=10`"),
    ("state_picture_not_carried", ({"photo": BUILD_REF}, {"x": noul("Is the bag in `photo` torn?")}), "^`photo` holds"),
    ("state_picture_not_carried", ({"after": {"photo": "img-0a1b2c3d4e5f"}}, {"x": noul("Is the bag in `after` torn?")}),
     "^`after.photo` holds"),
    ("box_many_targets", (PHOTO, {"spill": box("Find every torn seam in `photo`")}, [REF]), '"every"'),
]


class LintStructureTests(pack_tests(lint_structure.PACK, CASES)):
    def test_rules_leave_ordinary_requests_alone(self):
        rules = {feature["id"]: feature["check"] for feature in lint_structure.PACK["features"]}
        for ident, request in QUIET:
            with self.subTest(rule=ident, questions=list(request[1])):
                self.assertEqual(rules[ident](request[0], request[1], set(request[2]) if len(request) > 2 else set()), [])

    def test_rules_catch_more_forms(self):
        rules = {feature["id"]: feature["check"] for feature in lint_structure.PACK["features"]}
        for ident, request, message in HITS:
            with self.subTest(rule=ident, questions=list(request[1])):
                found = rules[ident](request[0], request[1], set(request[2]) if len(request) > 2 else set())
                self.assertEqual(len(found), 1)
                self.assertRegex(found[0][1], message)

    def test_quiet_on_every_built_in_request(self):
        assert_quiet(self, lint_structure.PACK)

    def test_anchors_are_known_guide_sections(self):
        known = {"#use-structure-in-the-input-state", "#decompose-the-questions", "#use-structure-in-the-questions"}
        self.assertTrue(all(feature["anchor"] in known for feature in lint_structure.PACK["features"]))

    def test_messages_never_quote_state_values(self):
        secret = "Zq9-secret-value-Zq9"
        cases = [{"message": secret, "note": "", "label": secret}, {"message": "<b>%s</b>" % secret},
                 {"message": '{"text": "%s"}' % secret}, {"message": "data:image/png;base64,%s" % secret},
                 {"link": "https://harbor.example/%s" % secret}]
        questions = {"x": noul("Does `link` or `note` mention a refund?")}
        reported = 0
        for state in cases:
            for feature in lint_structure.PACK["features"]:
                for _question, message in feature["check"](state, questions, set()):
                    reported += 1
                    self.assertNotIn(secret, message, feature["id"])
        self.assertGreater(reported, 5)


if __name__ == "__main__":
    unittest.main()
