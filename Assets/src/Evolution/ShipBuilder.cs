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
            EnemyTags = tags.Distinct().ToList();
        }

        public string GetFirstEnemyTag()
        {
            return EnemyTags.FirstOrDefault();
        }

        public void SetEnemyTags(List<string> allEnemyTags)
        {
            EnemyTags = allEnemyTags;
        }

        public List<string> GetEnemyTags()
        {
            return EnemyTags;
        }

        public List<string> EnemyTags;
        #endregion

        public int MaxTurrets = 10;
        public int MaxModules = 15;
        private int _turretsAdded = 0;
        private int _modulesAdded = 0;
        
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
            //Debug.Log("Building " + _genome);
            _r = GetNumberFromGenome(0, 8);
            _g = GetNumberFromGenome(10, 8);
            _b = GetNumberFromGenome(20, 8);
            _shipToBuildOn.SetColor(_r,_g,_b);
            //Debug.Log("Spawning modules");
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
                    if (_genomePosition < _genome.Length && _turretsAdded < MaxTurrets && _modulesAdded < MaxModules)
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
                    //else
                    //{
                    //    Debug.Log("Can Spawn No More modules. _genomePosition: " + _genomePosition + ", _turretsAdded: " + _turretsAdded + ", _modulesAdded: " + _modulesAdded);
                    //}
                }
            } else
            {
                //this has no spawn points, so it must be aturret or engine - increment added turrets.
                //Debug.Log("Cannot spawn on " + currentHub);
                _turretsAdded++;
            }
            _modulesAdded++;
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
                //Debug.Log("Gene to spawn: " + substring);
                _genomePosition += GeneLength;

                var simplified = substring.Replace(" ", "");

                int number;
                if (int.TryParse(simplified, out number))
                {
                    //Debug.Log("Gene as number: " + number);
                    if(number < Modules.Count())
                    {
                        //Debug.Log("Adding Module " + number + ": " + Modules[number] );
                        return Modules[number];
                    }
                    //else
                    //{
                    //    Debug.Log("there are " + Modules.Count() + " modules, so cannot spawn number " + number);
                    //}
                }
                //else
                //{
                //    Debug.Log("Failed to parse " + simplified + "as a number");
                //}
            }
            //else
            //{
            //    Debug.Log("Cannot read gene of length" + GeneLength + " at position " + _genomePosition + " in " + _genome);
            //}
            return null;
        }
        private void ConfigureShip()
        {
            var controller = _shipToBuildOn.GetComponent<SpaceShipControler>();

            controller.ShootAngle = GetNumberFromGenome(_genome, 0) * MaxShootAngle;
            controller.TorqueMultiplier = GetNumberFromGenome(_genome, 2) * MaxTorqueMultiplier;
            controller.LocationAimWeighting = GetNumberFromGenome(_genome, 4) * MaxLocationAimWeighting;
            controller.SlowdownWeighting = GetNumberFromGenome(_genome, 6) * MaxSlowdownWeighting;
            controller.MaxRange = GetNumberFromGenome(_genome, 8) * MaxLocationTollerance;
            controller.MinRange = GetNumberFromGenome(_genome, 10) * MaxLocationTollerance;
            controller.MaxTangentialVelocity = GetNumberFromGenome(_genome, 12) * MaxVelociyTollerance;
            controller.MinTangentialVelocity = GetNumberFromGenome(_genome, 14) * MaxVelociyTollerance;
            controller.TangentialSpeedWeighting = GetNumberFromGenome(_genome, 16) * MaxSlowdownWeighting;
            controller.AngularDragForTorquers = GetNumberFromGenome(_genome, 18) * MaxAngularDragForTorquers;
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

