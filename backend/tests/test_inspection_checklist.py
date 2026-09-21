"""Prove a checklist form: a regulator's table that decides whether an inspection can pass.

The MCH self-assessment checklist is added as a form; opened during an
inspection it is answered Yes, No or N/A per requirement; it passes only when
every requirement is answered and none is unmet; and either-or pairs on the
paper (2.1 OR 2.2) count once.

    DATABASE_URL=sqlite:// python backend/tests/test_inspection_checklist.py
"""
from __future__ import annotations

import importlib.util
import os
import pathlib
import sys

os.environ.setdefault("DATABASE_URL", "sqlite://")
BACKEND = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from test_inspection_programme import TODAY, build, refused  # noqa: E402

from app.api.v1.endpoints import inspection_programme as api  # noqa: E402
from app.models.inspection import Inspection  # noqa: E402
from app.models.inspection_form import InspectionForm  # noqa: E402
from app.schemas.inspection_programme import InspectNowIn, RecordItemIn  # noqa: E402
from app.services import checklist  # noqa: E402


def mch_form() -> dict:
    """The form exactly as the migration adds it."""
    path = BACKEND / "alembic" / "versions" / "f2b4d6e8a0c1_mch_self_assessment_checklist.py"
    spec = importlib.util.spec_from_file_location("mch_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.FORM


def all_answers(value: str = "yes") -> dict:
    return {row["code"]: value for row in checklist.requirements(mch_form()["schema"])}


def test_the_form_is_the_paper_form():
    form = mch_form()
    schema = form["schema"]
    assert form["name"] == "Self-assessment Checklist for MCH Centers and Midwifery Services"
    assert checklist.is_checklist(schema)
    sections = schema["checklist"]["sections"]
    assert [s["code"] for s in sections] == ["Ind 01", "Ind 02", "Ind 03", "Ind 04", "Ind 05", "Ind 06", "Ind 07"]
    codes = [row["code"] for row in checklist.requirements(schema)]
    assert len(codes) == 26 and codes[0] == "1.1" and codes[-1] == "7.5"
    assert [len(s["requirements"]) for s in sections] == [4, 4, 3, 5, 3, 2, 5]
    # The canvas builder reads a top-level "sections"; this must never look like one of its layouts.
    assert "sections" not in schema and "components" not in schema
    print("ok  the form is the paper's seven indicators and twenty-six requirements")


def test_a_checklist_passes_only_when_every_requirement_is_met():
    schema = mch_form()["schema"]

    everything = checklist.evaluate(schema, all_answers("yes"))
    assert everything["can_pass"] and everything["met"] == 26 and not everything["unanswered"]

    one_missing = all_answers("yes")
    one_missing.pop("4.3")
    result = checklist.evaluate(schema, one_missing)
    assert not result["can_pass"] and result["unanswered"] == ["4.3"]
    assert checklist.summary_line(result) == "1 of 26 requirements still to answer"

    one_no = {**all_answers("yes"), "3.2": "no"}
    result = checklist.evaluate(schema, one_no)
    assert not result["can_pass"] and result["not_met"] == ["3.2"]
    assert checklist.summary_line(result) == "1 requirement not met: 3.2"

    # N/A: the ramp is not needed on the ground floor, the photograph is optional.
    optional = {**all_answers("yes"), "2.4": "na", "4.2": "na"}
    result = checklist.evaluate(schema, optional)
    assert result["can_pass"] and result["not_applicable"] == 2
    print("ok  a checklist passes only when every requirement is answered and none is unmet")


def test_either_or_pairs_count_once():
    schema = mch_form()["schema"]
    # Access is fine (2.1), so the blockade clause (2.2) does not apply and a No there is harmless.
    either = {**all_answers("yes"), "2.1": "yes", "2.2": "no", "6.1": "no", "6.2": "yes"}
    assert checklist.evaluate(schema, either)["can_pass"]

    neither = {**all_answers("yes"), "2.1": "no", "2.2": "no"}
    result = checklist.evaluate(schema, neither)
    assert not result["can_pass"] and result["not_met"] == ["2.1 or 2.2"]
    print("ok  an either-or pair on the paper is met by either of its halves")


def test_recording_an_inspection_enforces_the_checklist():
    db, site, _, people, departments, equipment, _ = build()
    form_data = mch_form()
    form = InspectionForm(name=form_data["name"], description=form_data["description"], schema=form_data["schema"])
    db.add(form)
    db.commit()

    # An item in no department, inspected now on the checklist chosen by hand.
    visit = api.inspect_now(InspectNowIn(facility_id=site.id, equipment_id=equipment["generator"]["id"],
                                         form_id=form.id), db=db, current_user=people["boss"])
    item = visit["item_list"][0]
    assert [f["form_id"] for f in item["forms"]] == [form.id], "the chosen form, and only that one"
    assert item["forms"][0]["schema"]["source"] == checklist.SOURCE

    def answers(values):
        return [{"form_id": form.id, "name": form.name, "answers": values}]

    incomplete = {**all_answers("yes")}
    incomplete.pop("7.5")
    detail = refused(lambda: api.record_item(visit["id"], item["id"], RecordItemIn(
        result="pass", answers=answers(incomplete)), db=db, current_user=people["boss"]), 422)
    assert "1 of 26 requirements still to answer" in detail, detail

    unmet = {**all_answers("yes"), "5.3": "no"}
    detail = refused(lambda: api.record_item(visit["id"], item["id"], RecordItemIn(
        result="pass", answers=answers(unmet)), db=db, current_user=people["boss"]), 422)
    assert "not met: 5.3" in detail, detail

    # Failing needs no completeness: one unmet requirement is reason enough.
    failed = api.record_item(visit["id"], item["id"], RecordItemIn(
        result="fail", answers=answers({"5.3": "no"}), note="No record of after-hours cases"),
        db=db, current_user=people["boss"])
    assert failed["item"]["result"] == "fail"
    stored = db.get(Inspection, item["id"])
    assert stored.form_data["checklists"][0]["not_met"] == ["5.3"]
    assert failed["item"]["checklists"][0]["name"] == form.name

    # Re-inspected and fully met, it passes, and the tally is kept.
    again = api.inspect_now(InspectNowIn(facility_id=site.id, equipment_id=equipment["generator"]["id"],
                                         form_id=form.id), db=db, current_user=people["boss"])
    passed = api.record_item(again["id"], again["item_list"][0]["id"], RecordItemIn(
        result="pass", answers=answers(all_answers("yes"))), db=db, current_user=people["boss"])
    assert passed["item"]["result"] == "pass"
    tally = passed["item"]["checklists"][0]
    assert tally["met"] == 26 and tally["can_pass"] and not tally["not_met"]
    db.close()
    print("ok  recording enforces the checklist: no pass while anything is unanswered or unmet")


def test_a_department_can_be_inspected_on_it():
    db, site, _, people, departments, equipment, forms = build()
    form_data = mch_form()
    form = InspectionForm(name=form_data["name"], schema=form_data["schema"])
    db.add(form)
    db.commit()
    from app.schemas.inspection_programme import FormAttachIn

    maternity = departments["pharmacy"]
    api.attach_form(maternity.id, FormAttachIn(form_id=form.id, default_frequency="annual"),
                    db=db, current_user=people["boss"])
    detail = api.department_detail(maternity.id, db=db, current_user=people["boss"])
    assert form.name in [f["name"] for f in detail["forms"]]
    print("ok  the checklist attaches to a department like any other form")


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)
             and v.__module__ == "__main__"]
    for t in tests:
        t()
    print(f"\n{len(tests)} checks passed")
