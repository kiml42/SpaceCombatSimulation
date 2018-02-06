using Assets.Src.ModuleSystem;
using NUnit.Framework;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.Editor.Evolution
{
    public class ModuleRecordTests
    {
        [Test]
        public void DefaultConstructor_givesBlankStrings()
        {
            var mr = new ModuleRecord();

            Assert.IsEmpty(mr.ToString());
            Assert.IsEmpty(mr.ToVerboseString());
        }

        [Test]
        public void ModuleNumberOnly()
        {
            var mr = new ModuleRecord(42);

            Assert.AreEqual("42", mr.ToString());
            Assert.IsEmpty(mr.ToVerboseString());
        }

        [Test]
        public void ModuleNameOnly()
        {
            var mr = new ModuleRecord(null, "name");

            Assert.IsEmpty(mr.ToString());
            Assert.AreEqual("name", mr.ToVerboseString());
        }

        [Test]
        public void WithEmptyHub()
        {
            var mr = new ModuleRecord(42, "name", true);

            Assert.AreEqual("42()", mr.ToString());
            Assert.AreEqual("name()", mr.ToVerboseString());
        }

        [Test]
        public void WithFilledHub()
        {
            var mr = new ModuleRecord(42, "name", true);
            mr.AddModule(new ModuleRecord(2, "name2"));
            mr.AddModule(null);
            mr.AddModule(new ModuleRecord(3, "name3", true));

            Assert.AreEqual("42(2,-,3())", mr.ToString());
            Assert.AreEqual("name(name2,-,name3())", mr.ToVerboseString());
        }

        [Test]
        public void ModuleTypeKnower_ModuleNumberOnly()
        {
            var mr = new ModuleRecord(null, 42);

            Assert.AreEqual("42", mr.ToString());
            Assert.IsEmpty(mr.ToVerboseString());
        }

        [Test]
        public void ModuleTypeKnower_ModuleNameOnly()
        {
            var go = new GameObject();
            go.AddComponent<ModuleTypeKnower>();
            var typeKnower = go.GetComponent<ModuleTypeKnower>();
            typeKnower.name = "name";

            var mr = new ModuleRecord(typeKnower);

            Assert.IsEmpty(mr.ToString());
            Assert.AreEqual("name", mr.ToVerboseString());
        }

        [Test]
        public void ModuleTypeKnower_WithEmptyHub()
        {
            var go = new GameObject();
            go.AddComponent<ModuleTypeKnower>();
            var typeKnower = go.GetComponent<ModuleTypeKnower>();
            typeKnower.name = "name";
            typeKnower.Types = new List<ModuleType>
                {
                    ModuleType.Hub
                };

            var mr = new ModuleRecord(typeKnower, 42);

            Assert.AreEqual("42()", mr.ToString());
            Assert.AreEqual("name()", mr.ToVerboseString());
        }

        [Test]
        public void ModuleTypeKnower_WithFilledHub()
        {
            var go = new GameObject();
            go.AddComponent<ModuleTypeKnower>();
            var typeKnower = go.GetComponent<ModuleTypeKnower>();
            typeKnower.name = "name";
            typeKnower.Types = new List<ModuleType>
                {
                    ModuleType.Hub
                };

            var go2 = new GameObject();
            go2.AddComponent<ModuleTypeKnower>();
            var typeKnower2 = go2.GetComponent<ModuleTypeKnower>();
            typeKnower2.name = "name2";
            typeKnower2.Types = new List<ModuleType>
                {
                    ModuleType.Turret
                };

            var go3 = new GameObject();
            go3.AddComponent<ModuleTypeKnower>();
            var typeKnower3 = go3.GetComponent<ModuleTypeKnower>();
            typeKnower3.name = "name3";
            typeKnower3.Types = new List<ModuleType>
                {
                    ModuleType.Hub
                };
            
            var mr = new ModuleRecord(typeKnower, 42);
            mr.AddModule(typeKnower2, 2);
            mr.AddModule(null);
            mr.AddModule(typeKnower3, 3);

            Assert.AreEqual("42(2,-,3())", mr.ToString());
            Assert.AreEqual("name(name2,-,name3())", mr.ToVerboseString());
        }

        [Test]
        public void ModuleTypeKnower_WithFilledHub_turretOnly()
        {
            var go = new GameObject();
            go.AddComponent<ModuleTypeKnower>();
            var typeKnower = go.GetComponent<ModuleTypeKnower>();
            typeKnower.name = "name";
            typeKnower.Types = new List<ModuleType>
                {
                    ModuleType.Hub
                };

            var go2 = new GameObject();
            go2.AddComponent<ModuleTypeKnower>();
            var typeKnower2 = go2.GetComponent<ModuleTypeKnower>();
            typeKnower2.name = "name2";
            typeKnower2.Types = new List<ModuleType>
                {
                    ModuleType.Turret
                };

            var mr = new ModuleRecord(typeKnower, 42);
            mr.AddModule(typeKnower2, 2);

            Assert.AreEqual("42(2)", mr.ToString());
            Assert.AreEqual("name(name2)", mr.ToVerboseString());
        }
    }
}
