using Assets.Src.Database;
using Assets.Src.Menus;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Assets.Src.Menus
{
    public class EvolutionDronesLoadList : GenericEvolutionLoadList
    {
        public void Start()
        {
            _handler = new EvolutionTargetShootingDatabaseHandler();
            GenericInitialisation();
        }
    }
}
