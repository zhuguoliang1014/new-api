#!/usr/bin/env python3
"""Run both prepared award functions against temporary PostgreSQL tables."""
import argparse
import ast
from pathlib import Path
import subprocess


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepared',type=Path,required=True)
    parser.add_argument('--database',default='image_studio_test')
    args=parser.parse_args()
    fixture=Path(__file__).with_name('award-safety-template.sql').read_text()
    for campaign in ('1603788','1604928'):
        path=args.prepared/f'grant-{campaign}.py'
        tree=ast.parse(path.read_text())
        function=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(name,ast.Name) and name.id=='SQL_FUNCTION' for name in n.targets))
        sql=fixture.replace('-- GIFT_GRANT_FUNCTION',function).replace("='yaohuo-thread-1603788'",f"='yaohuo-thread-{campaign}'")
        subprocess.run(['psql','-X','-v','ON_ERROR_STOP=1',args.database],input=sql,text=True,check=True,capture_output=True)
        print(f'{campaign}: gift expiry, original eligibility, deduplication, receipt/log/audit and balance verified; rolled back temporary tables')


if __name__=='__main__':
    main()
