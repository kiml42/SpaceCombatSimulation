using Assets.Src.Interfaces;
using Assets.Src.ObjectManagement;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Assets.src.Evolution
{
    public class ShipBuilder : IKnowsEnemyTagAndtag
    {
        #region EnemyTags
            public void AddEnemyTag(string newTag)
            {
                var tags = EnemyTags.ToList();
                tags.Add(newTag);
                EnemyTags = tags.Distinct();
            }

            public string GetFirstEnemyTag()
            {
                return EnemyTags.FirstOrDefault();
            }

            public void SetEnemyTags(IEnumerable<string> allEnemyTags)
            {
                EnemyTags = allEnemyTags;
            }

            public IEnumerable<string> GetEnemyTags()
            {
            return EnemyTags;
            }

            public IEnumerable<string> EnemyTags;
        #endregion

        public int MaxTurrets = 10;
        private int _turretsAdded = 0;
        
        public int MaxShootAngle = 1;
        public int MaxTorqueMultiplier = 2000;
        public int MaxLocationAimWeighting = 10;
        public int MaxSlowdownWeighting = 60;
        public int MaxLocationTollerance = 1000;
        public int MaxVelociyTollerance = 200;
        public int MaxAngularDragForTorquers = 1;
        

        private string _genome;
        public int GeneLength = 1;
        
        public List<Rigidbody> Modules;

        private int _genomePosition = 0;
        private float _r;
        private float _g;
        private float _b;
        private Transform _shipToBuildOn;

        public ShipBuilder(string genome, Transform shipToBuildOn, List<Rigidbody> modules)
        {
            _shipToBuildOn = shipToBuildOn;
            Modules = modules;
            _genome = genome;
        }

        public void BuildShip()
        {
            _r = GetNumberFromGenome(0, 8);
            _g = GetNumberFromGenome(10, 8);
            _b = GetNumberFromGenome(20, 8);
            _shipToBuildOn.SetColor(_r,_g,_b);
            SpawnModules(_shipToBuildOn);

            ConfigureShip();
        }

        public void SetGenome(string genome)
        {
            _genome = genome;
        }

        private void SpawnModules(Transform currentHub)
        {
            var spawnPoints = GetSpawnPoints(currentHub);
            if (spawnPoints.Any())
            {
                //this is a hub - add more modules to it
                foreach (var spawnPoint in spawnPoints)
                {
                    if (_genomePosition < _genome.Length && _turretsAdded < MaxTurrets)
                    {
                        var moduleToAdd = SelectModule();

                        if (moduleToAdd != null)
                        {
                            var addedModule = GameObject.Instantiate(moduleToAdd, spawnPoint.position, spawnPoint.rotation, spawnPoint);

                            addedModule.transform.parent = currentHub;
                            addedModule.GetComponent<FixedJoint>().connectedBody = currentHub.GetComponent<Rigidbody>();
                            addedModule.SendMessage("SetEnemyTags", EnemyTags, SendMessageOptions.DontRequireReceiver);

                            addedModule.tag = currentHub.tag;

                            SpawnModules(addedModule.transform);    //spawn modules on this module

                            addedModule.transform.SetColor(_r,_g,_b);
                        }
                    }
                }
            } else
            {
                //this has no spawn points, so it must be aturret or engine - increment added turrets.
                _turretsAdded++;
            }
        }

        private float GetNumberFromGenome(int fromStart, int length = 2)
        {
            if(fromStart + length < _genome.Length)
            {
                var substring = _genome.Substring(fromStart, length);

                var simplified = substring.Replace(" ", "0");
                int number;
                if (int.TryParse(simplified, out number))
                {
                    return (float) (number / (Math.Pow(10, length)-1));
                }
            }
            return 1;
        }

        private List<Transform> GetSpawnPoints(Transform currentHub)
        {
            var _spawnPoints = new List<Transform>();
            var childCount = currentHub.childCount;
            for (int i = 0; i < childCount; i++)
            {
                var child = currentHub.GetChild(i);
                if (child.name.Contains("SP"))
                {
                    _spawnPoints.Add(child);
                }
            }
            return _spawnPoints;
        }

        private Rigidbody SelectModule()
        {
            if (_genomePosition + GeneLength < _genome.Length)
            {
                var substring = _genome.Substring(_genomePosition, GeneLength);

                _genomePosition += GeneLength;

                var simplified = substring.Replace(" ", "");

                int number;
                if (int.TryParse(simplified, out number))
                {
                    if(number < _genome.Length)
                    {
                        return Modules[number];
                    }
                }
            }
            return null;
        }
        private void ConfigureShip()
        {
            var controller = _shipToBuildOn.GetComponent<SpaceShipControler>();
            controller.ShootAngle = GetNumberFromGenome(_genome, 0) * MaxShootAngle;
            controller.TorqueMultiplier = GetNumberFromGenome(_genome, 2) * MaxTorqueMultiplier;
            controller.LocationAimWeighting = GetNumberFromGenome(_genome, 4) * MaxLocationAimWeighting;
            controller.SlowdownWeighting = GetNumberFromGenome(_genome, 6) * MaxSlowdownWeighting;
            controller.LocationTollerance = GetNumberFromGenome(_genome, 8) * MaxLocationTollerance;
            controller.VelociyTollerance = GetNumberFromGenome(_genome, 10) * MaxVelociyTollerance;
            controller.AngularDragForTorquers = GetNumberFromGenome(_genome, 12) * MaxAngularDragForTorquers;
        }


        private float GetNumberFromGenome(string genome, int fromEnd)
        {
            var simplified = genome.Replace(" ", "");
            if (simplified.Length > fromEnd)
            {
                simplified = Reverse(simplified) + "  ";
                var stringNumber = simplified.Substring(fromEnd, 2);
                int number;
                if (int.TryParse(stringNumber, out number))
                {
                    return number / 99f;
                }
            }
            return 1;
        }
        
        public static string Reverse(string s)
        {
            char[] charArray = s.ToCharArray();
            Array.Reverse(charArray);
            return new string(charArray);
        }
    }
}

