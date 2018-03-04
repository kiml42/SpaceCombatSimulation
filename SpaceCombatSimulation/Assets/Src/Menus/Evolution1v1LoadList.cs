using Assets.Src.Database;
using Assets.Src.Menus;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Assets.Src.Menus
{
    public class Evolution1v1LoadList : GenericEvolutionLoadList
    {
        public void Start()
        {
            _handler = new EvolutionBrDatabaseHandler();
            GenericInitialisation();
        }
    }
}
